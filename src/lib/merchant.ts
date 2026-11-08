// =====================================================================
// 店名まわりの規則。
//  - normalizeMerchant: 「ｾﾌﾞﾝ-ｲﾚﾌﾞﾝ 林寺店」と「セブンイレブン林寺」を同じ店として扱うための正規化
//  - guessMerchantCategory: 店名からカテゴリを当てる（ユーザーの学習ルール → 既知の店名 → 品名キーワード）
//  - looksLikeSubscription: サブスクらしい店名か
// =====================================================================
import { matchCategoryKeyword, normalizeName } from '../../supabase/functions/_shared/receipt-rules';
import type { MerchantRule } from './types';

/** 比較用に店名を正規化する。半角カナ→全角、英字小文字化、数字・記号・空白・会社種別を落とす */
export function normalizeMerchant(s: string | null | undefined): string {
  if (!s) return '';
  return normalizeName(s)
    .toLowerCase()
    .replace(/株式会社|\(株\)|（株）|有限会社|\(有\)|（有）|合同会社/g, '')
    .replace(/[0-9０-９]/g, '')
    .replace(/[\s\-‐－—/／\\.,，、。・･()（）[\]「」【】*＊#＃:：;；'"’”!！?？&＆+＋_＿~〜|｜]/g, '')
    .trim();
}

/** 店名パターン（サブスク台帳・学習ルール）が店名に当たるか。正規化後の部分一致 */
export function merchantMatches(merchant: string | null | undefined, pattern: string): boolean {
  const m = normalizeMerchant(merchant);
  const p = normalizeMerchant(pattern);
  return p !== '' && m.includes(p);
}

/**
 * 既知の店名 → カテゴリ。カード明細の店名表記（半角カナ・英字大文字）を想定し、正規化後の文字列で判定する。
 * 上から順に見るので、より限定的なものを先に置く。
 */
const KNOWN_MERCHANTS: Array<[string, RegExp]> = [
  ['固定費', /電力|電気|でんき|ガス|水道|ntt|ドコモ|docomo|^au|kddi|ソフトバンク|softbank|楽天モバイル|uqモバイル|ワイモバイル|ymobile|povo|ahamo|linemo|mineo|iijmio|保険|生命|損保|共済|家賃|管理費|nhk|光|インターネット|プロバイダ|sonet|biglobe|ocn|nuro|ニューロ|google(one|storage)|icloud|apple\.?com\/?bill|itunes|dropbox|microsoft|adobe|notion|github|openai|chatgpt|anthropic|claude|cursor|amazonwebservices|aws|vercel|supabase|cloudflare|さくらインターネット|エックスサーバー|xserver|conoha|お名前|onamae|ムームー|レンタルサーバ/],
  ['娯楽費', /netflix|ネットフリックス|spotify|amazonprime|primevideo|amazonプライム|youtube|hulu|unext|u-next|dazn|abema|disney|ディズニープラス|nintendo|ニンテンドー|playstation|プレイステーション|sony.*(network|entertainment)|steam|blizzard|battlenet|riot|epicgames|xbox|twitch|discord|niconico|ニコニコ|dアニメ|ピッコマ|kindle|audible|オーディブル|booklive|dmm|fanza|カラオケ|映画|シネマ|toho|ゲーム|ガチャ|ジム|フィットネス|エニタイム|anytime|chocozap|チョコザップ|ゴールドジム|ティップネス|コナミスポーツ|ルネサンス|ライブ|チケット|ぴあ|イープラス|eplus|ローチケ|漫画|コミック|書店|ブックオフ|bookoff|ジュンク堂|紀伊國屋|tsutaya|ゲオ|geo/],
  ['医療費', /病院|クリニック|医院|歯科|眼科|皮膚科|内科|外科|整形|整骨|接骨|鍼灸|薬剤|調剤|処方|メディカル/],
  ['日用品', /ドラッグ|薬局|マツモトキヨシ|マツキヨ|ウエルシア|ココカラ|ツルハ|サンドラッグ|スギ薬|クリエイト|キリン堂|ダイソー|セリア|キャンドゥ|無印|ニトリ|カインズ|コーナン|ドンキホーテ|ドンキ|ドン・キホーテ|ホームセンター|ロフト|loft|ハンズ|hands|イケア|ikea|ユニクロ|uniqlo|gu$|^gu|しまむら|ワークマン|zozo|クリーニング|コインランドリー/],
  ['交通費', /^jr|ｊｒ|鉄道|電鉄|メトロ|地下鉄|交通|バス|タクシー|^go$|gotaxi|didi|uber(?!eats)|eneos|エネオス|出光|idemitsu|apollostation|コスモ石油|シェル|shell|駐車|パーキング|parking|タイムズ|times|三井のリパーク|etc|高速|nexco|suica|pasmo|icoca|新幹線|エクスプレス予約|smartex|えきねっと|航空|ana|jal|peach|ジェットスター|jetstar|skymark|スカイマーク|レンタカー|カーシェア|タイムズカー|timescar/],
  ['食費', /セブン|イレブン|ローソン|lawson|ファミリーマート|ファミマ|familymart|ミニストップ|デイリーヤマザキ|ニューデイズ|newdays|イオン|aeon|ライフ|マルエツ|西友|seiyu|サミット|業務スーパー|成城石井|オーケー|ok\b|ヨーカドー|イトーヨーカ|まいばすけっと|阪急オアシス|ピーコック|コープ|生協|マクドナルド|mcdonald|スターバックス|スタバ|starbucks|ドトール|doutor|タリーズ|tully|コメダ|サンマルク|エクセルシオール|すき家|吉野家|松屋|なか卯|ガスト|サイゼリヤ|バーミヤン|ジョナサン|デニーズ|ココス|ロイヤルホスト|ubereats|ウーバーイーツ|出前館|wolt|menu|モスバーガー|mos|ケンタッキー|kfc|ロッテリア|バーガーキング|burgerking|フレッシュネス|丸亀|はなまる|かつや|ココイチ|coco壱|スシロー|くら寿司|はま寿司|かっぱ寿司|餃子の王将|王将|日高屋|幸楽苑|天下一品|一蘭|ラーメン|ピザ|pizza|ドミノ|サブウェイ|subway|居酒屋|鳥貴族|磯丸|ダイニング|食堂|レストラン|カフェ|cafe|珈琲|コーヒー|coffee|ベーカリー|パン|スイーツ|ケーキ|焼肉|寿司|そば|うどん|弁当|ほっともっと|オリジン|デリ|フード|food|キッチン|kitchen|酒|リカー|ワイン|サントリー|セブンネット/],
];

/** 月額・年額の請求になりがちな店名 */
const SUBSCRIPTION_HINT = /netflix|spotify|amazonprime|primevideo|amazonプライム|youtube|hulu|unext|u-next|dazn|abema|disney|nintendo.*online|playstation.*(plus|network)|xbox|twitch|discord|niconico|ニコニコ|dアニメ|kindle.*unlimited|audible|オーディブル|google(one|storage|play)|icloud|apple\.?com\/?bill|itunes|dropbox|microsoft|adobe|notion|github|openai|chatgpt|anthropic|claude|cursor|vercel|supabase|cloudflare|さくらインターネット|xserver|エックスサーバー|conoha|お名前|onamae|ジム|フィットネス|エニタイム|anytime|chocozap|チョコザップ|ゴールドジム|ドコモ|docomo|^au|kddi|ソフトバンク|softbank|楽天モバイル|uqモバイル|ワイモバイル|ymobile|povo|ahamo|linemo|mineo|iijmio|nhk|保険|電力|電気|ガス|水道|光|プロバイダ|sonet|biglobe|ocn|nuro|レンタルサーバ|月額|年会費|会費|サブスク|premium|プレミアム|plus$|pro$/;

/**
 * 店名からカテゴリを当てる。
 *  1. ユーザーが直したことのある店名（merchant_rules。部分一致）
 *  2. 既知の店名リスト
 *  3. レシート用の品名キーワード（「チャージ」「ガソリン」など）
 *  4. 候補に無ければ「その他」（カード明細はネット通販など中身が分からない店が多いので、食費には寄せない）
 */
export function guessMerchantCategory(merchant: string, rules: Pick<MerchantRule, 'pattern' | 'category'>[], categories: string[]): string {
  const pick = (c: string | null | undefined) => (c && categories.includes(c) ? c : null);
  for (const r of rules) {
    if (merchantMatches(merchant, r.pattern)) { const c = pick(r.category); if (c) return c; }
  }
  const norm = normalizeMerchant(merchant);
  if (norm !== '') {
    for (const [cat, re] of KNOWN_MERCHANTS) {
      if (re.test(norm)) { const c = pick(cat); if (c) return c; }
    }
  }
  return pick(matchCategoryKeyword(normalizeName(merchant), categories)) ?? pick('その他') ?? categories[0] ?? 'その他';
}

export function looksLikeSubscription(merchant: string | null | undefined): boolean {
  const norm = normalizeMerchant(merchant);
  return norm !== '' && SUBSCRIPTION_HINT.test(norm);
}

/** サブスク台帳の名前に使う表示名。半角カナを全角にし、余分な空白を詰める */
export function displayMerchant(merchant: string): string {
  return normalizeName(merchant).replace(/\s+/g, ' ').trim();
}
