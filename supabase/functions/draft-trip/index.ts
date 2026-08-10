// =====================================================================
// Edge Function: draft-trip
//
// 行き先と日程からしおりの下書きを作る。
// 出力は構造化出力（response_format の json_schema / strict）で JSON に固定して
// いるので、本文をパースして壊れる心配がない。
//
// 生成するのは「たたき台」であって確定した予定ではない。
// 営業時間・料金・所要時間は実在の情報を保証できないので、
// プロンプトでも UI でもその前提を明示している。
//
// SDK を使わず fetch で直接叩いているのは ask-ai / embedding.ts と同じ理由。
// =====================================================================
import { createClient } from 'npm:@supabase/supabase-js@^2.107.0';
import { CORS, json } from '../_shared/cors.ts';

const CHAT_ENDPOINT = 'https://api.openai.com/v1/chat/completions';
const MODEL = 'gpt-5.6-luna';
const REASONING_EFFORT = 'low';
const MAX_OUTPUT_TOKENS = 16000;
const DAILY_LIMIT = 20;
const MAX_DAYS = 14;

// strict モードの制約: ルートは object、全 object に additionalProperties: false、
// 全プロパティを required に入れる。
const DRAFT_SCHEMA = {
  type: 'object',
  properties: {
    items: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          day: { type: 'integer', description: '何日目か。1が初日' },
          start_time: { type: 'string', description: 'HH:MM 形式。決められない場合は空文字' },
          kind: { type: 'string', enum: ['move', 'stay', 'eat', 'see', 'other'] },
          title: { type: 'string', description: '予定の内容（短く）' },
          place: { type: 'string', description: '場所や施設名。なければ空文字' },
          memo: { type: 'string', description: '補足。なければ空文字' },
        },
        required: ['day', 'start_time', 'kind', 'title', 'place', 'memo'],
        additionalProperties: false,
      },
    },
    checklist: {
      type: 'array',
      description: '持ち物のチェックリスト',
      items: { type: 'string' },
    },
  },
  required: ['items', 'checklist'],
  additionalProperties: false,
} as const;

const SYSTEM_PROMPT = `あなたは旅程づくりを手伝うアシスタントです。日本語で答えてください。

作り方:
- 移動・宿・食事・観光をバランスよく入れ、1日に詰め込みすぎないでください。
- 初日は移動から、最終日は帰りの移動で終わるようにしてください。
- 時刻は目安として入れてください。決められないものは空文字にしてください。
- 持ち物は、その行き先・季節に固有のものを優先してください（歯ブラシのような一般的すぎるものは少なめに）。

守ること:
- 営業時間・料金・所要時間・予約可否といった、変わりやすく検証できない情報は書かないでください。
- 実在するか確信が持てない施設名は出さず、「海沿いのカフェ」のような一般的な書き方にしてください。
- これは確定した予定ではなく、利用者が調べて直すためのたたき台です。`;

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json({ error: 'POST のみ受け付けます' }, 405);

  const apiKey = Deno.env.get('OPENAI_API_KEY');
  if (!apiKey) return json({ error: 'サーバーに OPENAI_API_KEY が設定されていません' }, 500);

  const authHeader = req.headers.get('Authorization');
  if (!authHeader) return json({ error: 'ログインが必要です' }, 401);

  let body: { destination?: string; days?: number; start_date?: string; style?: string };
  try {
    body = await req.json();
  } catch {
    return json({ error: 'リクエストの形式が不正です' }, 400);
  }

  const destination = (body.destination ?? '').trim();
  const style = (body.style ?? '').trim();
  const days = Number(body.days);

  if (destination === '') return json({ error: '行き先を入力してください' }, 400);
  if (destination.length > 100) return json({ error: '行き先が長すぎます' }, 400);
  if (style.length > 500) return json({ error: '希望が長すぎます（500文字まで）' }, 400);
  if (!Number.isInteger(days) || days < 1 || days > MAX_DAYS) {
    return json({ error: `日数は1〜${MAX_DAYS}日で指定してください` }, 400);
  }

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_ANON_KEY')!,
    { global: { headers: { Authorization: authHeader } }, auth: { persistSession: false } },
  );

  const { data: userData, error: userErr } = await supabase.auth.getUser();
  if (userErr || !userData.user) return json({ error: 'ログイン情報を確認できませんでした' }, 401);

  // 「AI に聞く」と同じ枠を消費する（コストの出口を1本にまとめる）
  const { data: used, error: quotaErr } = await supabase.rpc('consume_ai_quota');
  if (quotaErr) return json({ error: `利用回数の確認に失敗しました: ${quotaErr.message}` }, 500);
  if (typeof used === 'number' && used > DAILY_LIMIT) {
    return json({ error: `本日の AI 利用回数の上限（${DAILY_LIMIT}回）に達しました。` }, 429);
  }

  try {
    const res = await fetch(CHAT_ENDPOINT, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: MODEL,
        max_completion_tokens: MAX_OUTPUT_TOKENS,
        reasoning_effort: REASONING_EFFORT,
        response_format: {
          type: 'json_schema',
          json_schema: { name: 'trip_draft', strict: true, schema: DRAFT_SCHEMA },
        },
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          {
            role: 'user',
            content:
              `行き先: ${destination}\n日数: ${days}日\n` +
              `${body.start_date ? `出発日: ${body.start_date}（季節の参考に）\n` : ''}` +
              `${style ? `希望: ${style}\n` : ''}\n` +
              'この条件で旅程のたたき台と持ち物リストを作ってください。',
          },
        ],
      }),
    });

    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      return json({ error: `下書きの生成に失敗しました (${res.status}): ${detail.slice(0, 300)}` }, 502);
    }

    const payload = await res.json();
    const choice = payload.choices?.[0];

    if (choice?.message?.refusal) {
      return json({ error: 'この内容では下書きを作れませんでした。条件を変えてお試しください。' }, 422);
    }
    if (choice?.finish_reason === 'length') {
      return json({ error: '下書きが長くなりすぎました。日数を減らしてお試しください。' }, 502);
    }

    const text = choice?.message?.content;
    if (typeof text !== 'string' || text.trim() === '') {
      return json({ error: '下書きを生成できませんでした' }, 502);
    }

    const draft = JSON.parse(text) as {
      items: Array<{ day: number; start_time: string; kind: string; title: string; place: string; memo: string }>;
      checklist: string[];
    };

    // 日数の範囲外を返してきた場合に備えて丸める
    const items = (draft.items ?? [])
      .filter((i) => i.title?.trim())
      .map((i) => ({ ...i, day: Math.min(Math.max(1, Math.round(i.day)), days) }));

    return json({ items, checklist: (draft.checklist ?? []).filter((c) => c.trim()) }, 200);
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : '下書きの生成に失敗しました' }, 502);
  }
});
