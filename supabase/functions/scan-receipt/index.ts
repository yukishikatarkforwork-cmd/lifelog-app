// =====================================================================
// Edge Function: scan-receipt
//
// レシート画像から店名・日付・明細・合計を構造化して返す。
// OCR サービスを別に契約せず、「AI に聞く」と同じ OpenAI のキー1本で済ませる。
// 画像1枚あたりの入力は 1〜2K トークン程度で、1回 1円未満。
//
// 自動登録はしない。返した結果はアプリ側の確認画面で直してから保存する
// （値引の扱い・税込換算・カテゴリ分けは機械的に決めきれないため）。
// =====================================================================
import { createClient } from 'npm:@supabase/supabase-js@^2.107.0';
import { CORS, json } from '../_shared/cors.ts';
import { normalizeReceipt, receiptSchema } from '../_shared/receipt.ts';

const CHAT_ENDPOINT = 'https://api.openai.com/v1/chat/completions';
// 画像入力に対応したモデル。ask-ai と同じ最安ティア
const MODEL = 'gpt-5.6-luna';
// 画像を受け付けない等でモデルが弾いたときの保険
const FALLBACK_MODEL = 'gpt-4o-mini';
const REASONING_EFFORT = 'low';
const MAX_OUTPUT_TOKENS = 4000;

/** 1日あたりの読み取り回数。1回 1円未満だが、無制限にはしない */
const DAILY_LIMIT = 40;
/** data URL の上限（長辺 2000px の WebP で 300〜600KB。base64 で 1.4 倍） */
const MAX_IMAGE_CHARS = 4 * 1024 * 1024;

const DEFAULT_CATEGORIES = ['食費', '日用品', '交通費', '医療費', '娯楽費', '固定費', 'その他'];

const SYSTEM_PROMPT = `あなたは日本のレシートを読み取り、家計簿に登録できる形に整理する係です。

読み取りの規則:
- 品名は半角カナや略称を読みやすい日本語に直す（例: 「ｲｪﾏｯﾄ ｶﾝｺｸﾃﾞﾝﾄｳﾉﾘ」→「韓国伝統のり」、「7P 国産米ｺﾞﾊﾝ 5ｺｲﾘ」→「国産米ごはん 5個入」）。
- 「値引」「シール割引」「○%引」などの割引行は独立した項目にせず、直前の品目の金額から引く。
- 「小計」「消費税」「合計」「お釣り」「ポイント」「会員コード」などの行は項目に含めない。
- レジ袋は「レジ袋」という項目として残す（カテゴリは日用品）。
- 各項目の amount は「税込・値引後」の金額にする。
  品目が税抜表示で合計時に税が加算されるレシート（コンビニに多い。「小計（税抜 8%）」「消費税等」の行がある）では、
  各品目に税率（* 印は 8%、無印は 10%）を掛けて税込に換算し、端数は最後の品目で調整して items の合計が total と一致するようにする。
  品目が税込表示のレシート（「内消費税」とだけ書かれている、または税額の行がない）では、そのままの金額を使う。
- total は実際に支払った合計金額（税込）。
- payment_method はレシートの支払方法から決める: クレジット支払→クレジット、iD/QUICPay/交通系/電子金券/○○Pay→電子マネー、現金→現金、不明なら null。
- date はレシートに印字された購入日（YYYY-MM-DD）。読めなければ null。
- category は与えられた候補から最も近いものを選ぶ。食品・飲料は食費、洗剤・ティッシュ・シェービングフォーム等は日用品、薬・サプリは医療費。
- 読み取りに自信がない数字や、割引の扱いで迷った点は notes に短く書く。無ければ null。`;

interface RequestBody {
  image?: string;        // data URL
  categories?: string[];
  default_date?: string; // レシートに日付がないとき用
}

async function callModel(apiKey: string, model: string, image: string, categories: string[], defaultDate: string | undefined) {
  const userText =
    `このレシートを読み取ってください。カテゴリの候補: ${categories.join(' / ')}。` +
    (defaultDate ? ` 日付が読めなければ ${defaultDate} を使ってください。` : '');

  return fetch(CHAT_ENDPOINT, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model,
      max_completion_tokens: MAX_OUTPUT_TOKENS,
      ...(model === MODEL ? { reasoning_effort: REASONING_EFFORT } : {}),
      response_format: {
        type: 'json_schema',
        json_schema: { name: 'receipt', strict: true, schema: receiptSchema(categories) },
      },
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        {
          role: 'user',
          content: [
            { type: 'text', text: userText },
            { type: 'image_url', image_url: { url: image, detail: 'high' } },
          ],
        },
      ],
    }),
  });
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json({ error: 'POST のみ受け付けます' }, 405);

  const apiKey = Deno.env.get('OPENAI_API_KEY');
  if (!apiKey) return json({ error: 'サーバーに OPENAI_API_KEY が設定されていません' }, 500);

  const authHeader = req.headers.get('Authorization');
  if (!authHeader) return json({ error: 'ログインが必要です' }, 401);

  let body: RequestBody;
  try {
    body = await req.json();
  } catch {
    return json({ error: 'リクエストの形式が不正です' }, 400);
  }

  const image = body.image ?? '';
  if (!/^data:image\/(jpeg|png|webp);base64,/.test(image)) {
    return json({ error: '画像は JPEG / PNG / WebP の data URL で送ってください' }, 400);
  }
  if (image.length > MAX_IMAGE_CHARS) return json({ error: '画像が大きすぎます' }, 413);

  const categories = [...new Set(
    (Array.isArray(body.categories) ? body.categories : [])
      .filter((c): c is string => typeof c === 'string' && c.trim() !== '')
      .map((c) => c.trim())
      .slice(0, 40),
  )];
  if (categories.length === 0) categories.push(...DEFAULT_CATEGORIES);
  const defaultDate = typeof body.default_date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(body.default_date)
    ? body.default_date : undefined;

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_ANON_KEY')!,
    { global: { headers: { Authorization: authHeader } }, auth: { persistSession: false } },
  );
  const { data: userData, error: userErr } = await supabase.auth.getUser();
  if (userErr || !userData.user) return json({ error: 'ログイン情報を確認できませんでした' }, 401);

  const { data: used, error: quotaErr } = await supabase.rpc('consume_quota', { p_kind: 'receipt' });
  if (quotaErr) return json({ error: `利用回数の確認に失敗しました: ${quotaErr.message}` }, 500);
  if (typeof used === 'number' && used > DAILY_LIMIT) {
    return json({ error: `本日のレシート読み取り回数の上限（${DAILY_LIMIT}回）に達しました。` }, 429);
  }

  let res: Response;
  let model = MODEL;
  try {
    res = await callModel(apiKey, model, image, categories, defaultDate);
    if (res.status === 400) {
      // 画像非対応などモデル側の都合なら、画像対応が確実なモデルで撮り直す
      const detail = await res.text().catch(() => '');
      if (/image|vision|modal|content/i.test(detail)) {
        model = FALLBACK_MODEL;
        res = await callModel(apiKey, model, image, categories, defaultDate);
      } else {
        return json({ error: `読み取りに失敗しました (400): ${detail.slice(0, 300)}` }, 502);
      }
    }
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : 'AI の呼び出しに失敗しました' }, 502);
  }

  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    return json({ error: `読み取りに失敗しました (${res.status}): ${detail.slice(0, 300)}` }, 502);
  }

  const completion = await res.json().catch(() => null) as {
    choices?: Array<{ message?: { content?: string | null; refusal?: string | null }; finish_reason?: string }>;
  } | null;
  const choice = completion?.choices?.[0];
  if (choice?.message?.refusal) return json({ error: `読み取れませんでした: ${choice.message.refusal}` }, 422);
  const content = choice?.message?.content;
  if (!content) return json({ error: 'AI から結果が返りませんでした' }, 502);

  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    return json({ error: '結果の形式を解釈できませんでした' }, 502);
  }

  const scan = normalizeReceipt(parsed, categories);
  if (scan.items.length === 0 && scan.total == null) {
    return json({ error: 'レシートとして読み取れませんでした。明るい場所で、全体が写るように撮り直してください。' }, 422);
  }

  return new Response(JSON.stringify(scan), {
    status: 200,
    headers: { ...CORS, 'Content-Type': 'application/json', 'X-Ai-Usage': `${used ?? 0}/${DAILY_LIMIT}`, 'X-Ai-Model': model },
  });
});
