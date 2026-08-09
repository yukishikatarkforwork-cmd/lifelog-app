import { supabase } from './supabase';
import { addDays, todayStr } from './date';
import type { WeatherKey } from './types';

/**
 * 動作確認用のサンプル記録。
 *
 * 意味検索と「似た日」が実際に効くことを確かめられるよう、次を意図して作ってある。
 *  - 場所や出来事を具体名で書く（「江ノ島」「箱根」など）→ 意味検索の的になる
 *  - 表記を意図的にずらす（日記に「海」と書かず「江ノ島」「稲村ヶ崎」と書く）
 *    → キーワード一致では出ないが意味検索では出る、という違いが見える
 *  - 低気圧＋頭痛、寝不足＋体調不良のような組み合わせを繰り返す
 *    → 相関と「似た日」に意味が出る
 *  - 直近120日にばらけさせる → 30日モードと全期間モードで結果が変わる
 */

interface SampleDay {
  /** 今日から何日前か */
  ago: number;
  title: string;
  body: string;
  tags: string[];
  condition: number;
  mood: number;
  sleep: number;
  headache?: boolean;
  medication?: boolean;
  weather: WeatherKey;
  pressure: number;
  temp: number;
  /** 食品名と kcal */
  meals?: Array<[string, number]>;
  /** カテゴリと金額 */
  expenses?: Array<[string, number]>;
}

const SAMPLE: SampleDay[] = [
  {
    ago: 2, title: '江ノ島までサイクリング', tags: ['おでかけ', '運動'],
    body: '天気がよかったので自転車で江ノ島まで。稲村ヶ崎あたりの海沿いが気持ちよかった。\nしらす丼を食べて、灯台にのぼって帰宅。日焼けした。',
    condition: 5, mood: 5, sleep: 7.5, weather: 'sunny', pressure: 1018, temp: 24,
    meals: [['しらす丼', 620], ['アイスコーヒー', 20]], expenses: [['娯楽費', 2400], ['交通費', 980]],
  },
  {
    ago: 5, title: '低気圧で頭が重い', tags: ['しんどい'],
    body: '朝から曇っていて頭が重い。午後に雨。薬を飲んで早めに寝た。\nこういう日は無理をしないほうがいい。',
    condition: 2, mood: 2, sleep: 5.5, headache: true, medication: true,
    weather: 'rainy', pressure: 998, temp: 19,
    meals: [['コンビニおにぎり', 180], ['うどん', 420]],
  },
  {
    ago: 8, title: '新宿のカフェで作業', tags: ['仕事'],
    body: '新宿の静かな喫茶店にこもって資料づくり。窓際の席が空いていて集中できた。\n夕方に同僚と合流して軽く飲んだ。',
    condition: 4, mood: 4, sleep: 7, weather: 'cloudy', pressure: 1012, temp: 21,
    meals: [['ブレンドコーヒー', 10], ['ナポリタン', 780], ['ビール', 200]],
    expenses: [['食費', 1800], ['娯楽費', 3200]],
  },
  {
    ago: 12, title: '実家に帰った', tags: ['家族'],
    body: '久しぶりに実家へ。母の作った筑前煮がやっぱりおいしい。\n父と将棋を指して負けた。庭の柿がだいぶ色づいていた。',
    condition: 4, mood: 5, sleep: 8.5, weather: 'sunny', pressure: 1020, temp: 22,
    meals: [['筑前煮', 320], ['白米', 250], ['味噌汁', 60]], expenses: [['交通費', 3400]],
  },
  {
    ago: 15, title: '歯医者と買い出し', tags: [],
    body: '歯のクリーニング。特に問題なしとのことで安心した。\n帰りにスーパーで一週間分の買い出し。',
    condition: 4, mood: 3, sleep: 6.5, weather: 'cloudy', pressure: 1010, temp: 20,
    expenses: [['医療費', 3800], ['食費', 6200]],
  },
  {
    ago: 18, title: '締切前で徹夜気味', tags: ['仕事', 'しんどい'],
    body: '提出前日で夜中まで作業。目が痛い。\n終わったら温泉にでも行きたい。',
    condition: 2, mood: 2, sleep: 3.5, weather: 'cloudy', pressure: 1008, temp: 18,
    meals: [['カップ麺', 450], ['エナジードリンク', 90]],
  },
  {
    ago: 21, title: '箱根で温泉', tags: ['旅行', 'おでかけ'],
    body: '締切が終わったので一泊で箱根へ。露天風呂から見えた山がきれいだった。\n芦ノ湖を散歩して、黒たまごを食べた。よく眠れた。',
    condition: 5, mood: 5, sleep: 9, weather: 'sunny', pressure: 1019, temp: 17,
    meals: [['温泉卵', 80], ['そば', 550], ['旅館の夕食', 900]],
    expenses: [['娯楽費', 18000], ['交通費', 4200]],
  },
  {
    ago: 26, title: '雨で一日家にいた', tags: ['読書'],
    body: '朝から強い雨。外に出る気にならず、積んでいた本を読んで過ごした。\n気圧のせいか夕方から少し頭が痛い。',
    condition: 3, mood: 3, sleep: 7, headache: true, weather: 'rainy', pressure: 1001, temp: 16,
    meals: [['トースト', 260], ['カレー', 750]],
  },
  {
    ago: 30, title: '会社の飲み会', tags: ['仕事', '外食'],
    body: '部署の歓迎会。焼肉だった。食べ過ぎた自覚がある。\n終電で帰ったので寝るのが遅くなった。',
    condition: 3, mood: 4, sleep: 5, weather: 'cloudy', pressure: 1013, temp: 19,
    meals: [['焼肉', 1400], ['ビール', 400], ['冷麺', 380]],
    expenses: [['食費', 5500], ['交通費', 620]],
  },
  {
    ago: 34, title: 'ジムを再開した', tags: ['運動'],
    body: '三か月ぶりにジムへ。軽めにランニングと胸のトレーニング。\n明日は確実に筋肉痛になる。',
    condition: 4, mood: 4, sleep: 7.5, weather: 'sunny', pressure: 1017, temp: 21,
    meals: [['プロテイン', 120], ['鶏むね肉', 220], ['サラダ', 90]],
    expenses: [['娯楽費', 1200]],
  },
  {
    ago: 38, title: '美術館に行った', tags: ['おでかけ'],
    body: '上野の美術館で展示を見た。静かな空間で二時間ほど。\n帰りに公園を歩いたら鳩がすごかった。',
    condition: 4, mood: 5, sleep: 8, weather: 'cloudy', pressure: 1015, temp: 18,
    expenses: [['娯楽費', 2200], ['交通費', 760]],
  },
  {
    ago: 43, title: '風邪をひいた', tags: ['しんどい'],
    body: '喉が痛くて熱っぽい。仕事を休んで寝ていた。\n薬を飲んでひたすら水分をとった。',
    condition: 1, mood: 2, sleep: 10, medication: true, weather: 'rainy', pressure: 1003, temp: 15,
    meals: [['おかゆ', 180], ['ゼリー', 100]], expenses: [['医療費', 1600]],
  },
  {
    ago: 47, title: '回復してきた', tags: [],
    body: '熱は下がった。まだ本調子ではないので家で軽く作業。\n三日ぶりにちゃんとした食事をとった。',
    condition: 3, mood: 3, sleep: 9, weather: 'cloudy', pressure: 1011, temp: 16,
    meals: [['雑炊', 300], ['りんご', 90]],
  },
  {
    ago: 52, title: '鎌倉を歩いた', tags: ['おでかけ', '友人'],
    body: '友人と鎌倉へ。長谷寺の階段がきつかったけど景色がよかった。\n由比ヶ浜まで下りて、波打ち際まで行った。抹茶のかき氷を食べた。',
    condition: 5, mood: 5, sleep: 8, weather: 'sunny', pressure: 1021, temp: 26,
    meals: [['かき氷', 280], ['釜揚げしらす定食', 780]],
    expenses: [['交通費', 1900], ['食費', 2600], ['娯楽費', 500]],
  },
  {
    ago: 57, title: '台風接近', tags: ['しんどい'],
    body: '台風が近づいていて一日中気圧が低い。頭痛がひどく、薬が効かない。\n電車も止まりそうだったので在宅にした。',
    condition: 1, mood: 2, sleep: 6, headache: true, medication: true,
    weather: 'rainy', pressure: 985, temp: 24,
    meals: [['冷凍パスタ', 480]],
  },
  {
    ago: 62, title: '図書館で勉強', tags: ['読書', '仕事'],
    body: '資格の勉強のため図書館へ。四時間ほど集中できた。\n家より圧倒的にはかどる。来週も行こう。',
    condition: 4, mood: 4, sleep: 7, weather: 'cloudy', pressure: 1014, temp: 22,
    meals: [['サンドイッチ', 340], ['コーヒー', 15]],
  },
  {
    ago: 68, title: '映画を観た', tags: ['娯楽', 'おでかけ'],
    body: 'ずっと気になっていた映画をようやく。思ったより静かな話だった。\nエンドロールまで座っていたのは久しぶり。',
    condition: 4, mood: 5, sleep: 7.5, weather: 'sunny', pressure: 1016, temp: 20,
    expenses: [['娯楽費', 1900], ['食費', 800]],
  },
  {
    ago: 74, title: '寝不足で頭が回らない', tags: ['しんどい', '仕事'],
    body: '夜更かししてしまい四時間しか寝ていない。会議で話が入ってこなかった。\n早く帰って寝る。',
    condition: 2, mood: 2, sleep: 4, weather: 'cloudy', pressure: 1009, temp: 19,
    meals: [['コーヒー', 15], ['牛丼', 720]],
  },
  {
    ago: 81, title: '引っ越しの手伝い', tags: ['友人', '運動'],
    body: '友人の引っ越しを手伝った。荷物が想像の三倍あった。\n全身が痛いが、夜のビールがうまかった。',
    condition: 3, mood: 4, sleep: 6.5, weather: 'sunny', pressure: 1018, temp: 23,
    meals: [['弁当', 680], ['ビール', 200]], expenses: [['食費', 1500]],
  },
  {
    ago: 89, title: '誕生日', tags: ['家族', '嬉しい'],
    body: '誕生日。家族がケーキを用意してくれていた。\n一年があっという間だった。来年はもう少し運動する。',
    condition: 5, mood: 5, sleep: 8, weather: 'sunny', pressure: 1020, temp: 21,
    meals: [['ケーキ', 380], ['ローストビーフ', 450]], expenses: [['食費', 4200]],
  },
  {
    ago: 96, title: '雨の日の頭痛', tags: ['しんどい'],
    body: 'また低気圧。朝から頭が重くて集中できない。\n傾向として雨の前日がいちばんつらい気がする。',
    condition: 2, mood: 2, sleep: 6, headache: true, medication: true,
    weather: 'rainy', pressure: 995, temp: 17,
    meals: [['そうめん', 350]],
  },
  {
    ago: 104, title: '海までドライブ', tags: ['おでかけ', '友人'],
    body: 'レンタカーで三浦半島まで。城ヶ島の岩場で写真を撮った。\n風が強かったが空が広くて気分がよかった。帰りに渋滞にはまった。',
    condition: 4, mood: 5, sleep: 7, weather: 'sunny', pressure: 1017, temp: 25,
    meals: [['まぐろ丼', 900]], expenses: [['交通費', 8400], ['食費', 3200]],
  },
  {
    ago: 112, title: '在宅で一日作業', tags: ['仕事'],
    body: '特筆することのない一日。ずっと家でコードを書いていた。\n夕方に散歩に出たくらい。',
    condition: 3, mood: 3, sleep: 7, weather: 'cloudy', pressure: 1013, temp: 20,
    meals: [['冷凍餃子', 520], ['白米', 250]],
  },
  {
    ago: 118, title: '花火大会', tags: ['おでかけ', '友人', '嬉しい'],
    body: '駅から会場まで人がすごかった。屋台で焼きそばとかき氷を買って、川沿いで見た。\n終わったあとの帰り道がいちばん混んでいた。',
    condition: 4, mood: 5, sleep: 6, weather: 'sunny', pressure: 1015, temp: 28,
    meals: [['焼きそば', 550], ['かき氷', 250], ['ビール', 200]],
    expenses: [['娯楽費', 2800], ['交通費', 880]],
  },
];

export interface SampleResult {
  days: number;
  diaries: number;
  meals: number;
  expenses: number;
}

/**
 * サンプル記録を投入する。
 * 体調・天気・日記は user×date が主キーなので upsert（同じ日の既存記録は上書きされる）。
 * 食事・支出は行が増える形なので、重複投入を避けたい場合は先に削除すること。
 */
export async function insertSampleData(userId: string): Promise<SampleResult> {
  const today = todayStr();
  const dated = SAMPLE.map((s) => ({ ...s, date: addDays(today, -s.ago) }));

  const conditions = dated.map((s) => ({
    user_id: userId, date: s.date,
    condition_score: s.condition, mood_score: s.mood, sleep_hours: s.sleep,
    headache: s.headache ?? false, medication: s.medication ?? false,
    memo: null,
  }));

  const weathers = dated.map((s) => ({
    user_id: userId, date: s.date,
    weather: s.weather, pressure_hpa: s.pressure, temperature: s.temp,
    humidity: null, memo: null,
  }));

  const diaries = dated.map((s) => ({
    user_id: userId, date: s.date,
    title: s.title, body: s.body, tags: s.tags,
  }));

  const meals = dated.flatMap((s) =>
    (s.meals ?? []).map(([name, kcal], i) => ({
      user_id: userId, date: s.date,
      meal_type: (['breakfast', 'lunch', 'dinner', 'snack'] as const)[Math.min(i, 3)],
      food_name: name, amount: null, calories: kcal,
      protein: null, fat: null, carbohydrate: null, memo: null, tags: [],
    })),
  );

  const expenses = dated.flatMap((s) =>
    (s.expenses ?? []).map(([category, amount]) => ({
      user_id: userId, date: s.date,
      amount, category, payment_method: null, memo: null,
    })),
  );

  const results = await Promise.all([
    supabase.from('daily_records').upsert(conditions, { onConflict: 'user_id,date' }),
    supabase.from('weather_records').upsert(weathers, { onConflict: 'user_id,date' }),
    supabase.from('diary_entries').upsert(diaries, { onConflict: 'user_id,date' }),
    supabase.from('meal_entries').insert(meals),
    supabase.from('expenses').insert(expenses),
  ]);

  const failed = results.find((r) => r.error);
  if (failed?.error) throw new Error(failed.error.message);

  return { days: dated.length, diaries: diaries.length, meals: meals.length, expenses: expenses.length };
}

/** サンプル投入で作られる日付（再インデックス対象を絞るのに使う） */
export function sampleDates(): string[] {
  const today = todayStr();
  return SAMPLE.map((s) => addDays(today, -s.ago));
}
