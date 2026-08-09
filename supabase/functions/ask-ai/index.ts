// =====================================================================
// Edge Function: ask-ai
//
// 「自分の記録について AI に質問する」機能のサーバー側。
// ブラウザから Claude を直接叩くと API キーが露出するため、ここを経由する。
//
//   [React] --JWT--> [ask-ai] --APIキー--> [Claude API]
//                      │
//                      ├ 1. JWT を検証し、その人のデータだけを RLS 経由で取得
//                      ├ 2. 集計値（平均・相関・カテゴリ別合計）を計算
//                      ├ 3. Markdown に整形して context に載せる
//                      └ 4. 回答をテキストストリームで返す
//
// ベクトル検索（RAG）は使っていない。1年分の記録でも context に収まる量で、
// 「先月の平均体調は？」のような集計質問はベクトル検索では正確に答えられないため、
// 集計は SQL/コード側で行い、生データと一緒に丸ごと渡す方が精度が高い。
// =====================================================================
import Anthropic from 'npm:@anthropic-ai/sdk@^0.110.0';
import { createClient } from 'npm:@supabase/supabase-js@^2.107.0';

// 1日あたりの質問回数の上限。入れないと API コストに歯止めがなくなる。
const DAILY_LIMIT = 20;
// 1回のリクエストで扱える最大日数。
const MAX_RANGE_DAYS = 400;
// 日数がこれを超えたら、構造化データは1日1行のサマリーに圧縮する（日記は全文のまま）。
const COMPACT_THRESHOLD_DAYS = 120;

const MODEL = 'claude-opus-5';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  // 残り回数・圧縮モードをクライアントから読めるようにする
  'Access-Control-Expose-Headers': 'X-Ai-Usage, X-Ai-Mode',
};

const MEAL_LABELS: Record<string, string> = {
  breakfast: '朝食', lunch: '昼食', dinner: '夕食', snack: '間食',
};
const WEATHER_LABELS: Record<string, string> = {
  sunny: '晴れ', cloudy: '曇り', rainy: '雨', snowy: '雪', other: 'その他',
};

interface MealRow {
  date: string; meal_type: string; food_name: string; amount: string | null;
  calories: number | null; protein: number | null; fat: number | null;
  carbohydrate: number | null; memo: string | null; tags: string[] | null;
}
interface ConditionRow {
  date: string; condition_score: number | null; mood_score: number | null;
  sleep_hours: number | null; headache: boolean; medication: boolean; memo: string | null;
}
interface WeatherRow {
  date: string; weather: string | null; pressure_hpa: number | null;
  temperature: number | null; humidity: number | null;
}
interface ExpenseRow {
  date: string; amount: number; category: string; payment_method: string | null; memo: string | null;
}
interface DiaryRow {
  date: string; title: string | null; body: string; tags: string[] | null;
}

interface Dataset {
  meals: MealRow[];
  conditions: ConditionRow[];
  weathers: WeatherRow[];
  expenses: ExpenseRow[];
  diaries: DiaryRow[];
}

// ---------- 集計 ----------

function mean(xs: number[]): number | null {
  if (xs.length === 0) return null;
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}

/** ピアソンの相関係数。3点未満か分散0のときは信頼できないので null */
function pearson(pairs: Array<[number, number]>): number | null {
  const n = pairs.length;
  if (n < 3) return null;
  const mx = mean(pairs.map((p) => p[0]))!;
  const my = mean(pairs.map((p) => p[1]))!;
  let num = 0, dx2 = 0, dy2 = 0;
  for (const [x, y] of pairs) {
    const a = x - mx, b = y - my;
    num += a * b; dx2 += a * a; dy2 += b * b;
  }
  if (dx2 === 0 || dy2 === 0) return null;
  return num / Math.sqrt(dx2 * dy2);
}

const r1 = (v: number | null) => (v == null ? '—' : v.toFixed(1));
const r2 = (v: number | null) => (v == null ? '—' : v.toFixed(2));

/**
 * 集計値を先に計算して渡す。
 * 「平均は？」「一番多いカテゴリは？」といった質問を本文から数え直させると誤差が出るため、
 * 確定値をこちらで出しておく。
 */
function buildSummary(d: Dataset, start: string, end: string): string {
  const lines: string[] = ['## 集計サマリー（計算済み・この数値を正とする）', ''];

  lines.push(`対象期間: ${start} 〜 ${end}`);

  // 体調
  const cond = d.conditions.filter((c) => c.condition_score != null);
  const sleep = d.conditions.filter((c) => c.sleep_hours != null);
  lines.push(
    `体調記録 ${cond.length} 日 / 平均体調 ${r1(mean(cond.map((c) => c.condition_score!)))} (1〜5) / ` +
    `平均気分 ${r1(mean(d.conditions.filter((c) => c.mood_score != null).map((c) => c.mood_score!)))} / ` +
    `平均睡眠 ${r1(mean(sleep.map((c) => c.sleep_hours!)))} h`,
  );
  lines.push(
    `頭痛のあった日 ${d.conditions.filter((c) => c.headache).length} 日 / ` +
    `服薬した日 ${d.conditions.filter((c) => c.medication).length} 日`,
  );

  // 食事（日ごとに合計してから平均を出す）
  const kcalByDate = new Map<string, number>();
  const pByDate = new Map<string, number>();
  const fByDate = new Map<string, number>();
  const cByDate = new Map<string, number>();
  for (const m of d.meals) {
    kcalByDate.set(m.date, (kcalByDate.get(m.date) ?? 0) + (m.calories ?? 0));
    pByDate.set(m.date, (pByDate.get(m.date) ?? 0) + (m.protein ?? 0));
    fByDate.set(m.date, (fByDate.get(m.date) ?? 0) + (m.fat ?? 0));
    cByDate.set(m.date, (cByDate.get(m.date) ?? 0) + (m.carbohydrate ?? 0));
  }
  lines.push(
    `食事記録 ${kcalByDate.size} 日 (${d.meals.length} 品) / 1日平均 ` +
    `${r1(mean([...kcalByDate.values()]))} kcal / ` +
    `P ${r1(mean([...pByDate.values()]))} / F ${r1(mean([...fByDate.values()]))} / C ${r1(mean([...cByDate.values()]))} g`,
  );

  // 家計簿
  const expTotal = d.expenses.reduce((s, e) => s + e.amount, 0);
  const byCat = new Map<string, number>();
  for (const e of d.expenses) byCat.set(e.category, (byCat.get(e.category) ?? 0) + e.amount);
  const expDates = new Set(d.expenses.map((e) => e.date));
  lines.push(`支出 合計 ¥${Math.round(expTotal).toLocaleString()} (${d.expenses.length} 件 / ${expDates.size} 日)`);
  if (byCat.size > 0) {
    const sorted = [...byCat.entries()].sort((a, b) => b[1] - a[1]);
    lines.push(`カテゴリ別（多い順）: ${sorted.map(([k, v]) => `${k} ¥${Math.round(v).toLocaleString()}`).join(' / ')}`);
  }

  // 日記
  lines.push(`日記 ${d.diaries.length} 件`);

  // 相関（体調に効いていそうな要因）
  const condBy = new Map(d.conditions.map((c) => [c.date, c]));
  const pressurePairs: Array<[number, number]> = [];
  for (const w of d.weathers) {
    const c = condBy.get(w.date);
    if (c?.condition_score != null && w.pressure_hpa != null) pressurePairs.push([w.pressure_hpa, c.condition_score]);
  }
  const sleepPairs: Array<[number, number]> = d.conditions
    .filter((c) => c.condition_score != null && c.sleep_hours != null)
    .map((c) => [c.sleep_hours!, c.condition_score!]);

  const rp = pearson(pressurePairs);
  const rs = pearson(sleepPairs);
  lines.push('');
  lines.push('相関係数（ピアソン、-1〜1。データ3点未満や分散0のときは — ）:');
  lines.push(`- 気圧 × 体調: ${r2(rp)} (${pressurePairs.length} 点)`);
  lines.push(`- 睡眠時間 × 体調: ${r2(rs)} (${sleepPairs.length} 点)`);
  lines.push('');

  return lines.join('\n');
}

// ---------- 本文の整形 ----------

/** 1日1行に圧縮した構造化データ（長期間を扱うとき用） */
function buildCompactDaily(d: Dataset, dates: string[]): string {
  const condBy = new Map(d.conditions.map((c) => [c.date, c]));
  const wthBy = new Map(d.weathers.map((w) => [w.date, w]));
  const kcalBy = new Map<string, number>();
  for (const m of d.meals) kcalBy.set(m.date, (kcalBy.get(m.date) ?? 0) + (m.calories ?? 0));
  const expBy = new Map<string, number>();
  for (const e of d.expenses) expBy.set(e.date, (expBy.get(e.date) ?? 0) + e.amount);

  const lines: string[] = [
    '## 日別サマリー（体調/気分/睡眠/頭痛/天気/気圧/摂取kcal/支出）',
    '',
    '| 日付 | 体調 | 気分 | 睡眠h | 頭痛 | 天気 | 気圧 | kcal | 支出 |',
    '|---|---|---|---|---|---|---|---|---|',
  ];
  for (const date of dates) {
    const c = condBy.get(date);
    const w = wthBy.get(date);
    lines.push(
      `| ${date} | ${c?.condition_score ?? ''} | ${c?.mood_score ?? ''} | ${c?.sleep_hours ?? ''} | ` +
      `${c?.headache ? '有' : ''} | ${w?.weather ? (WEATHER_LABELS[w.weather] ?? w.weather) : ''} | ` +
      `${w?.pressure_hpa ?? ''} | ${Math.round(kcalBy.get(date) ?? 0) || ''} | ${Math.round(expBy.get(date) ?? 0) || ''} |`,
    );
  }
  lines.push('');
  return lines.join('\n');
}

/** 日ごとの詳細（食事の品目・支出の明細まで含む） */
function buildFullDaily(d: Dataset, dates: string[]): string {
  const condBy = new Map(d.conditions.map((c) => [c.date, c]));
  const wthBy = new Map(d.weathers.map((w) => [w.date, w]));
  const mealsBy = new Map<string, MealRow[]>();
  for (const m of d.meals) { const a = mealsBy.get(m.date) ?? []; a.push(m); mealsBy.set(m.date, a); }
  const expBy = new Map<string, ExpenseRow[]>();
  for (const e of d.expenses) { const a = expBy.get(e.date) ?? []; a.push(e); expBy.set(e.date, a); }

  const lines: string[] = ['## 日別の記録', ''];
  for (const date of dates) {
    lines.push(`### ${date}`);

    const c = condBy.get(date);
    if (c) {
      const parts: string[] = [];
      if (c.condition_score != null) parts.push(`体調 ${c.condition_score}/5`);
      if (c.mood_score != null) parts.push(`気分 ${c.mood_score}/5`);
      if (c.sleep_hours != null) parts.push(`睡眠 ${c.sleep_hours}h`);
      if (c.headache) parts.push('頭痛あり');
      if (c.medication) parts.push('服薬あり');
      if (parts.length > 0) lines.push(`体調: ${parts.join(' / ')}`);
      if (c.memo) lines.push(`体調メモ: ${c.memo.replace(/\n/g, ' ')}`);
    }

    const w = wthBy.get(date);
    if (w) {
      const parts: string[] = [];
      if (w.weather) parts.push(WEATHER_LABELS[w.weather] ?? w.weather);
      if (w.pressure_hpa != null) parts.push(`${w.pressure_hpa}hPa`);
      if (w.temperature != null) parts.push(`${w.temperature}℃`);
      if (w.humidity != null) parts.push(`湿度${w.humidity}%`);
      if (parts.length > 0) lines.push(`天気・気圧: ${parts.join(' / ')}`);
    }

    const meals = mealsBy.get(date);
    if (meals && meals.length > 0) {
      const kcal = meals.reduce((s, m) => s + (m.calories ?? 0), 0);
      lines.push(`食事: 合計 ${Math.round(kcal)} kcal`);
      for (const m of meals) {
        lines.push(
          `- ${MEAL_LABELS[m.meal_type] ?? m.meal_type} ${m.food_name}` +
          `${m.amount ? ` ${m.amount}` : ''}${m.calories != null ? ` ${m.calories}kcal` : ''}` +
          `${m.memo ? ` (${m.memo.replace(/\n/g, ' ')})` : ''}`,
        );
      }
    }

    const exps = expBy.get(date);
    if (exps && exps.length > 0) {
      const sum = exps.reduce((s, e) => s + e.amount, 0);
      lines.push(`支出: 合計 ¥${Math.round(sum).toLocaleString()}`);
      for (const e of exps) {
        lines.push(`- ${e.category} ¥${Math.round(e.amount).toLocaleString()}${e.memo ? ` ${e.memo.replace(/\n/g, ' ')}` : ''}`);
      }
    }

    lines.push('');
  }
  return lines.join('\n');
}

/** 日記は常に全文を入れる（「あの日どこ行ったっけ」に答えられるのはここだけ） */
function buildDiaries(d: Dataset): string {
  if (d.diaries.length === 0) return '';
  const lines: string[] = ['## 日記（全文）', ''];
  for (const e of [...d.diaries].sort((a, b) => a.date.localeCompare(b.date))) {
    lines.push(`### ${e.date}${e.title ? ` ${e.title}` : ''}`);
    if (e.tags && e.tags.length > 0) lines.push(`タグ: ${e.tags.join(', ')}`);
    lines.push(e.body);
    lines.push('');
  }
  return lines.join('\n');
}

const SYSTEM_PROMPT = `あなたはユーザー本人の生活記録（体調・睡眠・天気気圧・食事・栄養・家計簿・日記）を読んで質問に答えるアシスタントです。日本語で答えてください。

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

// ---------- ハンドラ ----------

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });

  const json = (body: unknown, status: number) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { ...CORS, 'Content-Type': 'application/json' },
    });

  if (req.method !== 'POST') return json({ error: 'POST のみ受け付けます' }, 405);

  const apiKey = Deno.env.get('ANTHROPIC_API_KEY');
  if (!apiKey) return json({ error: 'サーバーに ANTHROPIC_API_KEY が設定されていません' }, 500);

  const authHeader = req.headers.get('Authorization');
  if (!authHeader) return json({ error: 'ログインが必要です' }, 401);

  let body: { question?: string; start?: string; end?: string };
  try {
    body = await req.json();
  } catch {
    return json({ error: 'リクエストの形式が不正です' }, 400);
  }

  const question = (body.question ?? '').trim();
  const start = body.start ?? '';
  const end = body.end ?? '';

  if (!question) return json({ error: '質問を入力してください' }, 400);
  if (question.length > 2000) return json({ error: '質問が長すぎます（2000文字まで）' }, 400);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(start) || !/^\d{4}-\d{2}-\d{2}$/.test(end)) {
    return json({ error: '期間の指定が不正です' }, 400);
  }
  if (start > end) return json({ error: '開始日が終了日より後になっています' }, 400);

  const rangeDays = Math.round(
    (Date.parse(`${end}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / 86_400_000,
  ) + 1;
  if (rangeDays > MAX_RANGE_DAYS) {
    return json({ error: `期間が長すぎます（${MAX_RANGE_DAYS}日まで）` }, 400);
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

  // 利用回数を消費する（上限超過なら 429）
  const { data: used, error: quotaErr } = await supabase.rpc('consume_ai_quota');
  if (quotaErr) return json({ error: `利用回数の確認に失敗しました: ${quotaErr.message}` }, 500);
  if (typeof used === 'number' && used > DAILY_LIMIT) {
    return json({ error: `本日の質問回数の上限（${DAILY_LIMIT}回）に達しました。明日また試してください。` }, 429);
  }

  const [mealsRes, condRes, wthRes, expRes, diaryRes] = await Promise.all([
    supabase.from('meal_entries').select('date,meal_type,food_name,amount,calories,protein,fat,carbohydrate,memo,tags').gte('date', start).lte('date', end).order('date'),
    supabase.from('daily_records').select('date,condition_score,mood_score,sleep_hours,headache,medication,memo').gte('date', start).lte('date', end).order('date'),
    supabase.from('weather_records').select('date,weather,pressure_hpa,temperature,humidity').gte('date', start).lte('date', end).order('date'),
    supabase.from('expenses').select('date,amount,category,payment_method,memo').gte('date', start).lte('date', end).order('date'),
    supabase.from('diary_entries').select('date,title,body,tags').gte('date', start).lte('date', end).order('date'),
  ]);

  const fetchErr = mealsRes.error || condRes.error || wthRes.error || expRes.error || diaryRes.error;
  if (fetchErr) return json({ error: `記録の読み込みに失敗しました: ${fetchErr.message}` }, 500);

  const dataset: Dataset = {
    meals: (mealsRes.data as MealRow[]) ?? [],
    conditions: (condRes.data as ConditionRow[]) ?? [],
    weathers: (wthRes.data as WeatherRow[]) ?? [],
    expenses: (expRes.data as ExpenseRow[]) ?? [],
    diaries: (diaryRes.data as DiaryRow[]) ?? [],
  };

  const total = dataset.meals.length + dataset.conditions.length + dataset.weathers.length
    + dataset.expenses.length + dataset.diaries.length;
  if (total === 0) {
    return json({ error: 'この期間には記録がありません。期間を広げてみてください。' }, 400);
  }

  const dates = [...new Set([
    ...dataset.meals.map((r) => r.date),
    ...dataset.conditions.map((r) => r.date),
    ...dataset.weathers.map((r) => r.date),
    ...dataset.expenses.map((r) => r.date),
    ...dataset.diaries.map((r) => r.date),
  ])].sort();

  // 長期間のときは構造化データを1日1行に落とす。日記は検索精度に直結するので圧縮しない。
  const compact = rangeDays > COMPACT_THRESHOLD_DAYS;
  const context = [
    buildSummary(dataset, start, end),
    compact ? buildCompactDaily(dataset, dates) : buildFullDaily(dataset, dates),
    buildDiaries(dataset),
  ].filter(Boolean).join('\n');

  const anthropic = new Anthropic({ apiKey });

  // クライアントが接続を切ったら Claude 側の生成も止める
  const abort = new AbortController();

  const stream = anthropic.messages.stream({
    model: MODEL,
    // 思考トークンも max_tokens に含まれるので余裕を持たせる
    max_tokens: 16000,
    // 回答の深さとコストのつまみ。低くしたい場合は 'medium' / 'low' に下げる
    output_config: { effort: 'high' },
    system: SYSTEM_PROMPT,
    messages: [
      {
        role: 'user',
        content:
          `以下は私の生活記録です。\n\n${context}\n\n---\n\n` +
          `上の記録をもとに、次の質問に答えてください。\n\n質問: ${question}`,
      },
    ],
  }, { signal: abort.signal });

  // 回答はプレーンテキストのストリームで返す（クライアントはそのまま読み進めるだけでよい）
  const encoder = new TextEncoder();
  const readable = new ReadableStream({
    async start(controller) {
      try {
        for await (const event of stream) {
          if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
            controller.enqueue(encoder.encode(event.delta.text));
          }
        }
        const final = await stream.finalMessage();
        if (final.stop_reason === 'refusal') {
          controller.enqueue(encoder.encode('\n\n[この質問には回答できませんでした]'));
        } else if (final.stop_reason === 'max_tokens') {
          controller.enqueue(encoder.encode('\n\n[回答が長くなりすぎたため途中で終了しました]'));
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
      'X-Ai-Mode': compact ? 'compact' : 'full',
    },
  });
});
