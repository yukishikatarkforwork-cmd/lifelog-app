// =====================================================================
// Edge Function: fetch-link-title
//
// 貼られた URL のページタイトルを取ってくる。
// タイトルがあると一覧が読みやすくなるだけでなく、ベクトル検索の対象になるので
// 「あの店の予約ページ貼ったのいつだっけ？」が引けるようになる。
//
// ⚠ ユーザーが指定した URL をサーバー側で fetch するので SSRF の的になる。
// 対策を入れてある:
//   - http / https のみ
//   - ホスト名が localhost・内部ドメイン・プライベートIPリテラルなら拒否
//   - 名前解決の結果がプライベートIPでも拒否（DNS リバインディング対策）
//   - リダイレクトは手動で追い、毎ホップ同じ検査をかける（上限3回）
//   - タイムアウト8秒、読み込みは先頭256KBまで、text/html 以外は読まない
// =====================================================================
import { CORS, json } from '../_shared/cors.ts';
import { createClient } from 'npm:@supabase/supabase-js@^2.107.0';

const TIMEOUT_MS = 8_000;
const MAX_BYTES = 256 * 1024;
const MAX_REDIRECTS = 3;

/** そのホスト名自体を拒否する（名前解決するまでもないもの） */
const BLOCKED_HOSTNAMES = new Set([
  'localhost', 'localhost.localdomain', 'ip6-localhost', 'ip6-loopback',
  // クラウドのインスタンスメタデータ（認証情報が置かれている）
  'metadata', 'metadata.google.internal',
]);

function isPrivateIPv4(ip: string): boolean {
  const parts = ip.split('.').map(Number);
  if (parts.length !== 4 || parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return false;
  const [a, b] = parts;
  return (
    a === 0 || a === 10 || a === 127 ||
    (a === 169 && b === 254) ||                 // リンクローカル（メタデータ 169.254.169.254 を含む）
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 100 && b >= 64 && b <= 127) ||       // CGNAT
    a >= 224                                     // マルチキャスト・予約
  );
}

function isPrivateIPv6(ip: string): boolean {
  const v = ip.toLowerCase().replace(/^\[|\]$/g, '');
  if (v === '::1' || v === '::') return true;
  if (v.startsWith('fe80') || v.startsWith('fc') || v.startsWith('fd')) return true;
  // IPv4 射影アドレス（::ffff:127.0.0.1 など）
  const m = v.match(/::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  return m ? isPrivateIPv4(m[1]) : false;
}

async function assertPublicHost(hostname: string): Promise<void> {
  const host = hostname.toLowerCase().replace(/\.$/, '');
  if (BLOCKED_HOSTNAMES.has(host) || host.endsWith('.localhost') || host.endsWith('.internal') || host.endsWith('.local')) {
    throw new Error('このアドレスは取得できません。');
  }
  if (isPrivateIPv4(host) || isPrivateIPv6(host)) {
    throw new Error('このアドレスは取得できません。');
  }

  // 名前解決の結果もチェックする（公開ドメインが内部IPを指しているケースを弾く）。
  // 権限や環境の都合で解決できないことがあるが、その場合は上のホスト名検査までで許容する。
  try {
    const [v4, v6] = await Promise.allSettled([
      Deno.resolveDns(host, 'A'),
      Deno.resolveDns(host, 'AAAA'),
    ]);
    const addrs = [
      ...(v4.status === 'fulfilled' ? v4.value : []),
      ...(v6.status === 'fulfilled' ? v6.value : []),
    ];
    if (addrs.some((ip) => isPrivateIPv4(ip) || isPrivateIPv6(ip))) {
      throw new Error('このアドレスは取得できません。');
    }
  } catch (e) {
    if (e instanceof Error && e.message === 'このアドレスは取得できません。') throw e;
    // 解決自体に失敗した場合は素通しにする（ホスト名検査は通過済み）
  }
}

function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, ' ')
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)));
}

/** og:title を優先し、なければ <title> を使う */
export function extractTitle(html: string): string | null {
  const og = html.match(/<meta[^>]+property=["']og:title["'][^>]*content=["']([^"']+)["']/i)
    ?? html.match(/<meta[^>]+content=["']([^"']+)["'][^>]*property=["']og:title["']/i);
  if (og?.[1]) return decodeEntities(og[1]).trim().slice(0, 300) || null;

  const t = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  if (t?.[1]) return decodeEntities(t[1]).replace(/\s+/g, ' ').trim().slice(0, 300) || null;

  return null;
}

/** 手動でリダイレクトを追い、毎回ホストを検査する */
async function fetchHtml(startUrl: string, signal: AbortSignal): Promise<string | null> {
  let url = new URL(startUrl);

  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    await assertPublicHost(url.hostname);

    const res = await fetch(url, {
      redirect: 'manual',
      signal,
      headers: {
        // 素の fetch だと弾くサイトがあるので、正体を明かしたうえで一般的な Accept を送る
        'User-Agent': 'LifelogBot/1.0 (+link title fetcher)',
        Accept: 'text/html,application/xhtml+xml',
      },
    });

    if (res.status >= 300 && res.status < 400) {
      const loc = res.headers.get('location');
      await res.body?.cancel();
      if (!loc) return null;
      url = new URL(loc, url);
      if (url.protocol !== 'http:' && url.protocol !== 'https:') {
        throw new Error('このアドレスは取得できません。');
      }
      continue;
    }

    if (!res.ok) {
      await res.body?.cancel();
      return null;
    }

    const ctype = res.headers.get('content-type') ?? '';
    if (!ctype.includes('text/html') && !ctype.includes('application/xhtml')) {
      await res.body?.cancel();
      return null;
    }

    // 先頭だけ読む。<title> はふつう先頭付近にあるし、巨大なページで詰まらせない
    const reader = res.body?.getReader();
    if (!reader) return null;
    const chunks: Uint8Array[] = [];
    let total = 0;
    while (total < MAX_BYTES) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      total += value.length;
    }
    await reader.cancel().catch(() => undefined);

    const buf = new Uint8Array(total);
    let off = 0;
    for (const c of chunks) { buf.set(c.subarray(0, Math.min(c.length, total - off)), off); off += c.length; }
    return new TextDecoder('utf-8', { fatal: false }).decode(buf);
  }

  throw new Error('リダイレクトが多すぎます。');
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json({ error: 'POST のみ受け付けます' }, 405);

  const authHeader = req.headers.get('Authorization');
  if (!authHeader) return json({ error: 'ログインが必要です' }, 401);

  let body: { url?: string };
  try {
    body = await req.json();
  } catch {
    return json({ error: 'リクエストの形式が不正です' }, 400);
  }

  let target: URL;
  try {
    target = new URL((body.url ?? '').trim());
  } catch {
    return json({ error: 'URL の形式が正しくありません' }, 400);
  }
  if (target.protocol !== 'http:' && target.protocol !== 'https:') {
    return json({ error: 'http または https の URL を指定してください' }, 400);
  }

  // ログイン済みかどうかだけ確認する（未ログインに外部 fetch を踏ませない）
  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_ANON_KEY')!,
    { global: { headers: { Authorization: authHeader } }, auth: { persistSession: false } },
  );
  const { data: userData, error: userErr } = await supabase.auth.getUser();
  if (userErr || !userData.user) return json({ error: 'ログイン情報を確認できませんでした' }, 401);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const html = await fetchHtml(target.toString(), controller.signal);
    return json({ title: html ? extractTitle(html) : null }, 200);
  } catch (e) {
    if (e instanceof DOMException && e.name === 'AbortError') {
      return json({ error: 'ページの取得がタイムアウトしました' }, 504);
    }
    // 取れなくても致命的ではない。タイトルなしで登録してもらう
    return json({ error: e instanceof Error ? e.message : 'ページを取得できませんでした' }, 502);
  } finally {
    clearTimeout(timer);
  }
});
