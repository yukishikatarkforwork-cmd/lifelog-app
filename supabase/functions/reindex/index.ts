// =====================================================================
// Edge Function: reindex
//
// 日記と日別要約の埋め込みを作り直す。差分だけを処理する。
//
// DB トリガではなくこの形にした理由:
// 「似た日」の要約は体調・天気・食事・家計簿・日記のどれが変わっても作り直す必要があり、
// トリガを張る箇所が5つに散る。1箇所で「今あるべき姿」と「今ある埋め込み」を突き合わせて
// 差分を埋める方式なら、呼ばれ方によらず必ず整合するし、取りこぼしても次回で自己修復する。
//
// 呼び出し元:
//  - 日記の保存・削除の直後（クライアントから、結果を待たずに）
//  - 設定画面の「再インデックス」ボタン（全件の作り直し）
// =====================================================================
import { createClient } from 'npm:@supabase/supabase-js@^2.107.0';
import { CORS, json } from '../_shared/cors.ts';
import { chunkText, embed, EmbeddingError, sha256 } from '../_shared/embedding.ts';
import { buildDaySummaryText, fetchRange, indexByDate } from '../_shared/records.ts';

/** 1回の呼び出しで埋め込みを作り直す最大件数（実行時間の上限に収めるため） */
const MAX_EMBED_PER_CALL = 300;

interface Target {
  kind: 'diary' | 'day';
  date: string;
  chunk_index: number;
  content: string;
  content_hash: string;
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json({ error: 'POST のみ受け付けます' }, 405);

  const authHeader = req.headers.get('Authorization');
  if (!authHeader) return json({ error: 'ログインが必要です' }, 401);

  let body: { dates?: string[]; all?: boolean } = {};
  try {
    body = await req.json();
  } catch {
    // ボディなしの呼び出しも許す（全件モードとして扱う）
  }

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_ANON_KEY')!,
    { global: { headers: { Authorization: authHeader } }, auth: { persistSession: false } },
  );

  const { data: userData, error: userErr } = await supabase.auth.getUser();
  if (userErr || !userData.user) return json({ error: 'ログイン情報を確認できませんでした' }, 401);
  const userId = userData.user.id;

  try {
    // --- 対象の日付を決める ---
    let dates: string[];
    if (body.dates && body.dates.length > 0) {
      dates = [...new Set(body.dates)].filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d));
      if (dates.length === 0) return json({ error: '日付の指定が不正です' }, 400);
    } else {
      const { data, error } = await supabase.rpc('lifelog_dates', { p_limit: 2000 });
      if (error) return json({ error: `対象日の取得に失敗しました: ${error.message}` }, 500);
      dates = ((data as Array<{ date: string }>) ?? []).map((r) => r.date);
    }

    if (dates.length === 0) {
      return json({ indexed: 0, deleted: 0, skipped: 0, message: '対象の記録がありません' }, 200);
    }

    // --- あるべき埋め込みの一覧を組み立てる ---
    const dataset = await fetchRange(supabase, '', '', dates);
    const idx = indexByDate(dataset);

    const targets: Target[] = [];
    for (const date of dates) {
      // 日別要約（似た日検索用）。何も記録がない日は作らない
      const summary = buildDaySummaryText(date, idx);
      // 日付だけの行（実質空）はベクトルにしても意味がないので除外する
      if (summary.length > date.length + 2) {
        targets.push({ kind: 'day', date, chunk_index: 0, content: summary, content_hash: await sha256(summary) });
      }

      // 日記本文（意味検索用）
      const diary = idx.diary.get(date);
      if (diary && diary.body.trim() !== '') {
        const header = [diary.date, diary.title, (diary.tags ?? []).join('、')].filter(Boolean).join(' ');
        const chunks = chunkText(diary.body);
        for (let i = 0; i < chunks.length; i++) {
          // 各チャンクに日付とタイトルを添える。チャンク単体だと文脈が失われるため
          const content = `${header}\n${chunks[i]}`;
          targets.push({ kind: 'diary', date, chunk_index: i, content, content_hash: await sha256(content) });
        }
      }
    }

    // --- 既存の埋め込みと突き合わせる ---
    const { data: existingRaw, error: exErr } = await supabase
      .from('embeddings')
      .select('id,kind,date,chunk_index,content_hash')
      .in('date', dates);
    if (exErr) return json({ error: `既存インデックスの取得に失敗しました: ${exErr.message}` }, 500);

    const existing = (existingRaw as Array<{ id: string; kind: string; date: string; chunk_index: number; content_hash: string }>) ?? [];
    const key = (k: string, d: string, i: number) => `${k}|${d}|${i}`;
    const existingByKey = new Map(existing.map((e) => [key(e.kind, e.date, e.chunk_index), e]));
    const wantedKeys = new Set(targets.map((t) => key(t.kind, t.date, t.chunk_index)));

    // 元データが消えた／短くなった分の埋め込みを消す（消し忘れると検索に幽霊が出る）
    const orphanIds = existing.filter((e) => !wantedKeys.has(key(e.kind, e.date, e.chunk_index))).map((e) => e.id);
    let deleted = 0;
    if (orphanIds.length > 0) {
      const { error } = await supabase.from('embeddings').delete().in('id', orphanIds);
      if (error) return json({ error: `古いインデックスの削除に失敗しました: ${error.message}` }, 500);
      deleted = orphanIds.length;
    }

    // ハッシュが同じものは作り直さない
    const stale = targets.filter((t) => existingByKey.get(key(t.kind, t.date, t.chunk_index))?.content_hash !== t.content_hash);
    const skipped = targets.length - stale.length;

    if (stale.length === 0) {
      return json({ indexed: 0, deleted, skipped, remaining: 0 }, 200);
    }

    const batch = stale.slice(0, MAX_EMBED_PER_CALL);
    const vectors = await embed(batch.map((t) => t.content));

    const rows = batch.map((t, i) => ({
      user_id: userId,
      kind: t.kind,
      date: t.date,
      chunk_index: t.chunk_index,
      content: t.content,
      content_hash: t.content_hash,
      embedding: vectors[i],
    }));

    const { error: upErr } = await supabase
      .from('embeddings')
      .upsert(rows, { onConflict: 'user_id,kind,date,chunk_index' });
    if (upErr) return json({ error: `インデックスの保存に失敗しました: ${upErr.message}` }, 500);

    return json({
      indexed: rows.length,
      deleted,
      skipped,
      // 上限で切れた分。クライアントは 0 になるまで呼び直す
      remaining: stale.length - batch.length,
    }, 200);
  } catch (e) {
    if (e instanceof EmbeddingError) return json({ error: e.message }, 502);
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
