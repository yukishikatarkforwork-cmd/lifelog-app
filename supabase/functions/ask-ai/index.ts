// =====================================================================
// Edge Function: ask-ai
//
// 「自分の記録について AI に質問する」機能のサーバー側。
// ブラウザから直接 OpenAI を叩くと API キーが露出するため、ここを経由する。
//
//   [React] --JWT--> [ask-ai] --APIキー--> [OpenAI Chat Completions]
//
// 質問の経路は3本ある（どれを使うかは期間の指定で決まる。分類器は置かない）。
//
//   1. 集計・統計        → lifelog_stats() で SQL 集計。どのモードでも必ず渡す
//   2. 期間が短い(〜1ヶ月) → その期間を全文投入。網羅性が要る質問に強い
//   3. 期間が長い/不明     → ベクトル検索で関連する日だけ拾う。コストが期間に依存しない
//
// 2 と 3 は排他ではなく役割が違う。30日程度なら全文投入の方が取りこぼしがなく、
// コストもほぼ変わらない（約9K vs 約7K トークン）。一方「いつだっけ」系は
// 期間を指定できないので 3 でしか答えられない。
//
// 集計を 1 に寄せているのは精度のためだけでなく、
// PostgREST が1リクエスト1000行で打ち切るため。行を取り寄せて数えると
// 長期間で件数が欠けて平均が静かに狂う。
//
// SDK を使わず fetch で直接叩いているのは、埋め込み（_shared/embedding.ts）が
// 同じ方式で OpenAI を呼んでいるため。依存が増えず、Deno 側のバージョン差にも左右されない。
// =====================================================================
import { createClient } from 'npm:@supabase/supabase-js@^2.107.0';
import { CORS, json } from '../_shared/cors.ts';
import { embed, EmbeddingError } from '../_shared/embedding.ts';
import {
  collectDates,
  fetchRange,
  formatCompactDaily,
  formatDiaries,
  formatFullDaily,
  formatStats,
  indexByDate,
  type Stats,
} from '../_shared/records.ts';

// 1日あたりの質問回数の上限。入れないと API コストに歯止めがなくなる。
const DAILY_LIMIT = 20;
// 期間指定モードで扱える最大日数。
const MAX_RANGE_DAYS = 400;
// これを超える期間は構造化データを1日1行に圧縮する（日記は全文のまま）。
const COMPACT_THRESHOLD_DAYS = 120;
// 全期間モードで拾う日記チャンク数と日別要約数。
const TOP_DIARY_CHUNKS = 24;
const TOP_DAYS = 12;

const CHAT_ENDPOINT = 'https://api.openai.com/v1/chat/completions';
const MODEL = 'gpt-5.6-luna';
// 推論の深さとコストのつまみ。推論トークンも出力として課金されるので、
// 上げるほど1質問あたりの単価が上がる。none / minimal / low / medium / high。
const REASONING_EFFORT = 'low';
const MAX_OUTPUT_TOKENS = 16000;

const SYSTEM_PROMPT = `あなたはユーザー本人の生活記録（体調・睡眠・体重・体組成・天気気圧・食事・栄養・家計簿・日記）を読んで質問に答えるアシスタントです。日本語で答えてください。

回答の作り方:
- 与えられた記録だけを根拠にしてください。記録にないことは推測せず「記録がない」と伝えてください。
- 数値を答えるときは「集計サマリー」の値をそのまま使ってください。日別データから数え直さないでください。
- 出来事や場所を聞かれたら、日記と各日の記録から探し、必ず日付を添えてください。該当が複数あれば全部挙げてください。
- 相関係数に触れるときは、相関は因果ではないこと、データ点が少なければ当てにならないことを添えてください。
- 医学的な断定はしないでください。気になる症状は受診をすすめてください。

書き方:
- 結論を最初の一文で述べ、根拠はその後に書いてください。
- 記録から言えることと、あなたの推測は区別してください。
- 簡潔に。関係する記録だけを引用し、全期間を要約し直さないでください。`;

// 全期間モードでは検索で拾えた分しか見えていないので、その前提を伝える
const SEARCH_MODE_NOTE = `注意: このモードでは全期間から検索で拾った記録だけが渡されています。
「集計サマリー」は全期間を対象に計算した確定値なので、件数や平均はそちらを使ってください。
一方、日別の記録と日記は関連度の高いものだけを抜き出したもので、全件ではありません。
「全部で何回」「一覧にして」のような網羅性が必要な質問には、
検索で見つかった範囲であることを断ったうえで答えてください。`;

interface MatchRow { date: string; chunk_index: number; content: string; similarity: number }

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json({ error: 'POST のみ受け付けます' }, 405);

  const apiKey = Deno.env.get('OPENAI_API_KEY');
  if (!apiKey) return json({ error: 'サーバーに OPENAI_API_KEY が設定されていません' }, 500);

  const authHeader = req.headers.get('Authorization');
  if (!authHeader) return json({ error: 'ログインが必要です' }, 401);

  let body: { question?: string; start?: string; end?: string; scope?: string };
  try {
    body = await req.json();
  } catch {
    return json({ error: 'リクエストの形式が不正です' }, 400);
  }

  const question = (body.question ?? '').trim();
  if (!question) return json({ error: '質問を入力してください' }, 400);
  if (question.length > 2000) return json({ error: '質問が長すぎます（2000文字まで）' }, 400);

  // scope='all' で全期間のベクトル検索モードになる
  const searchMode = body.scope === 'all';

  const start = body.start ?? '';
  const end = body.end ?? '';
  let rangeDays = 0;

  if (!searchMode) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(start) || !/^\d{4}-\d{2}-\d{2}$/.test(end)) {
      return json({ error: '期間の指定が不正です' }, 400);
    }
    if (start > end) return json({ error: '開始日が終了日より後になっています' }, 400);
    rangeDays = Math.round(
      (Date.parse(`${end}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / 86_400_000,
    ) + 1;
    if (rangeDays > MAX_RANGE_DAYS) {
      return json({ error: `期間が長すぎます（${MAX_RANGE_DAYS}日まで）。「全期間」を選ぶと制限なく検索できます。` }, 400);
    }
  }

  // ユーザーの JWT でクライアントを作る。以降のクエリには RLS がかかるので、
  // この関数が他人のデータを読むことはできない。
  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_ANON_KEY')!,
    { global: { headers: { Authorization: authHeader } }, auth: { persistSession: false } },
  );

  const { data: userData, error: userErr } = await supabase.auth.getUser();
  if (userErr || !userData.user) return json({ error: 'ログイン情報を確認できませんでした' }, 401);
  const userId = userData.user.id;

  // 利用回数を消費する（上限超過なら 429）
  const { data: used, error: quotaErr } = await supabase.rpc('consume_ai_quota');
  if (quotaErr) return json({ error: `利用回数の確認に失敗しました: ${quotaErr.message}` }, 500);
  if (typeof used === 'number' && used > DAILY_LIMIT) {
    return json({ error: `本日の質問回数の上限（${DAILY_LIMIT}回）に達しました。明日また試してください。` }, 429);
  }

  let context: string;
  let mode: string;

  try {
    if (searchMode) {
      // --- 全期間モード: 質問をベクトル化して関連する記録だけ拾う ---
      const [queryVec] = await embed([question]);

      const [diaryHits, dayHits] = await Promise.all([
        supabase.rpc('match_embeddings', {
          query_embedding: queryVec, match_kind: 'diary', match_count: TOP_DIARY_CHUNKS,
        }),
        supabase.rpc('match_embeddings', {
          query_embedding: queryVec, match_kind: 'day', match_count: TOP_DAYS,
        }),
      ]);
      const hitErr = diaryHits.error || dayHits.error;
      if (hitErr) return json({ error: `検索に失敗しました: ${hitErr.message}` }, 500);

      const diaryRows = (diaryHits.data as MatchRow[]) ?? [];
      const dayRows = (dayHits.data as MatchRow[]) ?? [];

      if (diaryRows.length === 0 && dayRows.length === 0) {
        return json({
          error: '検索できる記録がありません。設定画面の「AI検索インデックスを作り直す」を実行してください。',
        }, 400);
      }

      // 全期間の集計は SQL で確定させる（検索で拾った分から数えてはいけない）
      const { data: statsData, error: statsErr } = await supabase.rpc('lifelog_stats', {
        p_start: '1900-01-01', p_end: '2999-12-31',
      });
      if (statsErr) return json({ error: `集計に失敗しました: ${statsErr.message}` }, 500);
      const stats = statsData as Stats;
      stats.period = { start: '全期間', end: '全期間' } as Stats['period'];

      // 拾えた日の詳細だけを実データから取り直す（検索結果の要約文ではなく正確な記録を見せる）
      const hitDates = [...new Set([...diaryRows.map((r) => r.date), ...dayRows.map((r) => r.date)])].sort();
      const dataset = await fetchRange(supabase, userId, '', '', hitDates);
      const idx = indexByDate(dataset);

      context = [
        formatStats(stats),
        SEARCH_MODE_NOTE,
        '',
        formatFullDaily(idx, hitDates, '## 検索で見つかった日の記録'),
        formatDiaries(dataset.diaries, '## 見つかった日の日記（全文）'),
      ].filter(Boolean).join('\n');
      mode = 'search';
    } else {
      // --- 期間指定モード ---
      const { data: statsData, error: statsErr } = await supabase.rpc('lifelog_stats', {
        p_start: start, p_end: end,
      });
      if (statsErr) return json({ error: `集計に失敗しました: ${statsErr.message}` }, 500);
      const stats = statsData as Stats;

      const dataset = await fetchRange(supabase, userId, start, end);
      const total = dataset.meals.length + dataset.conditions.length + dataset.weathers.length
        + dataset.expenses.length + dataset.diaries.length;
      if (total === 0) {
        return json({ error: 'この期間には記録がありません。期間を広げてみてください。' }, 400);
      }

      const idx = indexByDate(dataset);
      const dates = collectDates(dataset);
      // 長期間のときは構造化データを1日1行に落とす。日記は検索精度に直結するので圧縮しない。
      const compact = rangeDays > COMPACT_THRESHOLD_DAYS;

      context = [
        formatStats(stats),
        compact ? formatCompactDaily(idx, dates) : formatFullDaily(idx, dates),
        compact ? formatDiaries(dataset.diaries) : '',
      ].filter(Boolean).join('\n');
      mode = compact ? 'compact' : 'full';
    }
  } catch (e) {
    if (e instanceof EmbeddingError) return json({ error: e.message }, 502);
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }

  // クライアントが接続を切ったら生成も止める
  const abort = new AbortController();

  let upstream: Response;
  try {
    upstream = await fetch(CHAT_ENDPOINT, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      signal: abort.signal,
      body: JSON.stringify({
        model: MODEL,
        max_completion_tokens: MAX_OUTPUT_TOKENS,
        reasoning_effort: REASONING_EFFORT,
        stream: true,
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          {
            role: 'user',
            content:
              `以下は私の生活記録です。\n\n${context}\n\n---\n\n` +
              `上の記録をもとに、次の質問に答えてください。\n\n質問: ${question}`,
          },
        ],
      }),
    });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : 'AI の呼び出しに失敗しました' }, 502);
  }

  if (!upstream.ok || !upstream.body) {
    const detail = await upstream.text().catch(() => '');
    return json({ error: `AI の呼び出しに失敗しました (${upstream.status}): ${detail.slice(0, 300)}` }, 502);
  }

  // 回答はプレーンテキストのストリームで返す（クライアントはそのまま読み進めるだけでよい）。
  // 上流は SSE なので、data: 行から差分テキストだけを取り出して素通しする。
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();
  const readable = new ReadableStream({
    async start(controller) {
      const reader = upstream.body!.getReader();
      let buffer = '';
      let finishReason: string | null = null;
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });

          // 行単位で処理する。行が途中で切れていた分は buffer に残して次のチャンクで揃える。
          let nl: number;
          while ((nl = buffer.indexOf('\n')) !== -1) {
            const line = buffer.slice(0, nl).trim();
            buffer = buffer.slice(nl + 1);
            if (!line.startsWith('data:')) continue;

            const payload = line.slice(5).trim();
            if (payload === '[DONE]') continue;

            try {
              const chunk = JSON.parse(payload);
              const choice = chunk.choices?.[0];
              const delta = choice?.delta?.content;
              if (typeof delta === 'string' && delta !== '') {
                controller.enqueue(encoder.encode(delta));
              }
              if (choice?.finish_reason) finishReason = choice.finish_reason;
            } catch {
              // 壊れた行は無視する（回答本体を止めるほどの事故ではない）
            }
          }
        }

        if (finishReason === 'length') {
          controller.enqueue(encoder.encode('\n\n[回答が長くなりすぎたため途中で終了しました]'));
        } else if (finishReason === 'content_filter') {
          controller.enqueue(encoder.encode('\n\n[この質問には回答できませんでした]'));
        }
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        controller.enqueue(encoder.encode(`\n\n[エラー] ${message}`));
      } finally {
        controller.close();
      }
    },
    cancel() {
      abort.abort();
    },
  });

  return new Response(readable, {
    headers: {
      ...CORS,
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Ai-Usage': `${used ?? 0}/${DAILY_LIMIT}`,
      'X-Ai-Mode': mode,
    },
  });
});
