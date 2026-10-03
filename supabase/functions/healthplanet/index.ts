// =====================================================================
// Edge Function: healthplanet
//
// タニタの体組成計アプリ「Health Planet」と連携し、体重・体組成を取り込む。
//
// 流れ:
//   1. auth_url   … アプリの「連携する」→ Health Planet の認可画面 URL を返す
//   2. connect    … 認可後に戻ってきた code をトークンに交換して保存し、過去1年分を取り込む
//   3. sync       … 前回同期以降の測定を取り込む（「今日」画面や設定から呼ぶ）
//   4. disconnect … トークンを破棄する（取り込んだ体重記録は残す）
//
// client_secret とユーザーのアクセストークンはブラウザに出さない。
// トークンは healthplanet_tokens に置き、service role でだけ読み書きする。
//
// 必要なシークレット:
//   supabase secrets set HEALTHPLANET_CLIENT_ID=... HEALTHPLANET_CLIENT_SECRET=...
// =====================================================================
import { CORS, json } from '../_shared/cors.ts';
import {
  HP_TAG_PARAM, formatHpDateTime, parseInnerscan, splitWindows,
  type BodyMeasurement, type InnerscanResponse,
} from '../_shared/healthplanet-parse.ts';
import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@^2.107.0';

const AUTH_ENDPOINT = 'https://www.healthplanet.jp/oauth/auth';
const TOKEN_ENDPOINT = 'https://www.healthplanet.jp/oauth/token';
const INNERSCAN_ENDPOINT = 'https://www.healthplanet.jp/status/innerscan.json';
const SCOPE = 'innerscan';

/** 初回連携で遡る期間 */
const INITIAL_BACKFILL_DAYS = 365;
/** 差分同期で前回同期時刻からさらに遡る日数（体組成計→アプリへの反映遅れを拾う） */
const SYNC_OVERLAP_DAYS = 7;
/** 期限のこれだけ前からトークンを更新する */
const REFRESH_MARGIN_MS = 24 * 60 * 60 * 1000;
const TIMEOUT_MS = 15_000;

const RECONNECT_MESSAGE = 'Health Planet との連携が切れました。設定画面から連携し直してください。';

class HpError extends Error {
  constructor(message: string, readonly status = 502, readonly reconnect = false) {
    super(message);
  }
}

interface TokenRow {
  user_id: string;
  access_token: string;
  refresh_token: string | null;
  expires_at: string;
  redirect_uri: string | null;
  last_synced_at: string | null;
}

interface TokenResponse {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number | string;
  error?: string;
  error_description?: string;
}

function credentials(): { clientId: string; clientSecret: string } {
  const clientId = Deno.env.get('HEALTHPLANET_CLIENT_ID');
  const clientSecret = Deno.env.get('HEALTHPLANET_CLIENT_SECRET');
  if (!clientId || !clientSecret) {
    throw new HpError(
      'Health Planet 連携が設定されていません。HEALTHPLANET_CLIENT_ID / HEALTHPLANET_CLIENT_SECRET をシークレットに設定してください。',
      503,
    );
  }
  return { clientId, clientSecret };
}

/** redirect_uri はアプリ自身の URL に限る（他所へ code を飛ばす形にさせない） */
function assertRedirectUri(uri: string | undefined): string {
  let u: URL;
  try {
    u = new URL(uri ?? '');
  } catch {
    throw new HpError('redirect_uri が不正です', 400);
  }
  const isLocal = u.hostname === 'localhost' || u.hostname === '127.0.0.1';
  if (u.protocol !== 'https:' && !(u.protocol === 'http:' && isLocal)) {
    throw new HpError('redirect_uri は https である必要があります', 400);
  }
  return u.toString();
}

async function fetchWithTimeout(url: string, init: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } catch (e) {
    if (e instanceof DOMException && e.name === 'AbortError') {
      throw new HpError('Health Planet への接続がタイムアウトしました', 504);
    }
    throw new HpError('Health Planet に接続できませんでした', 502);
  } finally {
    clearTimeout(timer);
  }
}

/** トークンエンドポイントを叩き、保存用の行に整える */
async function requestToken(params: Record<string, string>): Promise<Pick<TokenRow, 'access_token' | 'refresh_token' | 'expires_at'>> {
  // 仕様書の例はクエリ文字列で渡しているが、フォーム本文で受ける実装例もある。両方に同じ値を載せる
  const query = new URLSearchParams(params);
  const res = await fetchWithTimeout(`${TOKEN_ENDPOINT}?${query}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: query.toString(),
  });
  const body = await res.json().catch(() => ({})) as TokenResponse;
  if (!res.ok || !body.access_token) {
    const detail = body.error_description ?? body.error ?? `HTTP ${res.status}`;
    throw new HpError(`Health Planet の認証に失敗しました: ${detail}`, 502, true);
  }
  // expires_in は秒。無ければ仕様どおり 30 日とみなす
  const expiresIn = Number(body.expires_in);
  const ttl = Number.isFinite(expiresIn) && expiresIn > 0 ? expiresIn : 30 * 24 * 60 * 60;
  return {
    access_token: body.access_token,
    refresh_token: body.refresh_token ?? null,
    expires_at: new Date(Date.now() + ttl * 1000).toISOString(),
  };
}

async function loadToken(admin: SupabaseClient, userId: string): Promise<TokenRow | null> {
  const { data, error } = await admin
    .from('healthplanet_tokens')
    .select('user_id,access_token,refresh_token,expires_at,redirect_uri,last_synced_at')
    .eq('user_id', userId)
    .maybeSingle();
  if (error) throw new HpError(error.message, 500);
  return data as TokenRow | null;
}

/** 期限が近ければ refresh_token で更新して保存する。更新できなければ再連携を求める */
async function ensureFreshToken(admin: SupabaseClient, row: TokenRow): Promise<TokenRow> {
  if (new Date(row.expires_at).getTime() - Date.now() > REFRESH_MARGIN_MS) return row;
  if (!row.refresh_token) throw new HpError(RECONNECT_MESSAGE, 401, true);

  const { clientId, clientSecret } = credentials();
  const fresh = await requestToken({
    client_id: clientId,
    client_secret: clientSecret,
    redirect_uri: row.redirect_uri ?? '',
    refresh_token: row.refresh_token,
    grant_type: 'refresh_token',
  });
  const { error } = await admin
    .from('healthplanet_tokens')
    .update({ ...fresh, last_error: null })
    .eq('user_id', row.user_id);
  if (error) throw new HpError(error.message, 500);
  return { ...row, ...fresh };
}

async function fetchInnerscan(accessToken: string, from: Date, to: Date): Promise<BodyMeasurement[]> {
  const params = new URLSearchParams({
    access_token: accessToken,
    date: '1', // 測定日時で絞る
    from: formatHpDateTime(from),
    to: formatHpDateTime(to),
    tag: HP_TAG_PARAM,
  });
  const res = await fetchWithTimeout(`${INNERSCAN_ENDPOINT}?${params}`, { method: 'GET' });
  if (res.status === 401 || res.status === 403) throw new HpError(RECONNECT_MESSAGE, 401, true);
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new HpError(`Health Planet から取得できませんでした (${res.status}): ${detail.slice(0, 200)}`, 502);
  }
  const body = await res.json().catch(() => null) as InnerscanResponse | null;
  if (!body) throw new HpError('Health Planet の応答を解釈できませんでした', 502);
  return parseInnerscan(body);
}

/**
 * 測定値を取り込む。手入力（source='manual'）の日は上書きしない。
 * 戻り値は取り込んだ日数。
 */
async function syncMeasurements(
  admin: SupabaseClient,
  row: TokenRow,
  opts: { full: boolean },
): Promise<number> {
  const now = new Date();
  const dayMs = 24 * 60 * 60 * 1000;
  const from = opts.full || !row.last_synced_at
    ? new Date(now.getTime() - INITIAL_BACKFILL_DAYS * dayMs)
    : new Date(new Date(row.last_synced_at).getTime() - SYNC_OVERLAP_DAYS * dayMs);

  const measurements: BodyMeasurement[] = [];
  for (const w of splitWindows(from, now)) {
    measurements.push(...await fetchInnerscan(row.access_token, w.from, w.to));
  }

  let synced = 0;
  if (measurements.length > 0) {
    const dates = measurements.map((m) => m.date);
    const { data: manual, error: manualErr } = await admin
      .from('body_records')
      .select('date')
      .eq('user_id', row.user_id)
      .eq('source', 'manual')
      .in('date', dates);
    if (manualErr) throw new HpError(manualErr.message, 500);
    const keep = new Set(((manual as Array<{ date: string }>) ?? []).map((r) => r.date));

    const rows = measurements
      .filter((m) => !keep.has(m.date))
      .map((m) => ({ ...m, user_id: row.user_id, source: 'healthplanet' }));
    if (rows.length > 0) {
      const { error } = await admin.from('body_records').upsert(rows, { onConflict: 'user_id,date' });
      if (error) throw new HpError(error.message, 500);
    }
    synced = rows.length;
  }

  const { error } = await admin
    .from('healthplanet_tokens')
    .update({ last_synced_at: now.toISOString(), last_error: null })
    .eq('user_id', row.user_id);
  if (error) throw new HpError(error.message, 500);
  return synced;
}

interface RequestBody {
  action?: 'auth_url' | 'connect' | 'sync' | 'disconnect';
  code?: string;
  redirect_uri?: string;
  state?: string;
  full?: boolean;
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json({ error: 'POST のみ受け付けます' }, 405);

  const authHeader = req.headers.get('Authorization');
  if (!authHeader) return json({ error: 'ログインが必要です' }, 401);

  let body: RequestBody;
  try {
    body = await req.json();
  } catch {
    return json({ error: 'リクエストの形式が不正です' }, 400);
  }

  const userClient = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_ANON_KEY')!,
    { global: { headers: { Authorization: authHeader } }, auth: { persistSession: false } },
  );
  const { data: userData, error: userErr } = await userClient.auth.getUser();
  if (userErr || !userData.user) return json({ error: 'ログイン情報を確認できませんでした' }, 401);
  const userId = userData.user.id;

  // トークン表は本人にも見せないので service role で触る（user_id は必ず上で確認した値を使う）
  const admin = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    { auth: { persistSession: false } },
  );

  try {
    switch (body.action) {
      case 'auth_url': {
        const { clientId } = credentials();
        const redirectUri = assertRedirectUri(body.redirect_uri);
        const params = new URLSearchParams({
          client_id: clientId,
          redirect_uri: redirectUri,
          scope: SCOPE,
          response_type: 'code',
        });
        // state は仕様に明記がないが、返してくれる場合に備えて付けておく（CSRF 対策はアプリ側で照合）
        if (body.state) params.set('state', body.state);
        return json({ url: `${AUTH_ENDPOINT}?${params}` }, 200);
      }

      case 'connect': {
        const code = (body.code ?? '').trim();
        if (!code) return json({ error: '認可コードがありません' }, 400);
        const redirectUri = assertRedirectUri(body.redirect_uri);
        const { clientId, clientSecret } = credentials();

        const token = await requestToken({
          client_id: clientId,
          client_secret: clientSecret,
          redirect_uri: redirectUri,
          code,
          grant_type: 'authorization_code',
        });
        const row = {
          user_id: userId, ...token, scope: SCOPE, redirect_uri: redirectUri,
          connected_at: new Date().toISOString(), last_synced_at: null, last_error: null,
        };
        const { error } = await admin.from('healthplanet_tokens').upsert(row, { onConflict: 'user_id' });
        if (error) throw new HpError(error.message, 500);

        // 初回は過去分をまとめて取り込む。失敗しても連携自体は成立しているので、その旨だけ返す
        try {
          const synced = await syncMeasurements(admin, { ...row, last_synced_at: null }, { full: true });
          return json({ connected: true, synced }, 200);
        } catch (e) {
          const message = e instanceof Error ? e.message : '取り込みに失敗しました';
          await admin.from('healthplanet_tokens').update({ last_error: message }).eq('user_id', userId);
          return json({ connected: true, synced: 0, warning: message }, 200);
        }
      }

      case 'sync': {
        const row = await loadToken(admin, userId);
        if (!row) return json({ error: 'Health Planet と連携していません' }, 404);
        try {
          const fresh = await ensureFreshToken(admin, row);
          const synced = await syncMeasurements(admin, fresh, { full: body.full === true });
          return json({ synced }, 200);
        } catch (e) {
          const message = e instanceof Error ? e.message : '同期に失敗しました';
          await admin.from('healthplanet_tokens').update({ last_error: message }).eq('user_id', userId);
          throw e;
        }
      }

      case 'disconnect': {
        const { error } = await admin.from('healthplanet_tokens').delete().eq('user_id', userId);
        if (error) throw new HpError(error.message, 500);
        return json({ connected: false }, 200);
      }

      default:
        return json({ error: 'action が不正です' }, 400);
    }
  } catch (e) {
    if (e instanceof HpError) return json({ error: e.message, reconnect: e.reconnect }, e.status);
    return json({ error: e instanceof Error ? e.message : '処理に失敗しました' }, 500);
  }
});
