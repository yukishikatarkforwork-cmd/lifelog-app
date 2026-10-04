// =====================================================================
// レシート専用 OCR（Azure Document Intelligence の prebuilt-receipt）の結果を
// 家計簿向けに整える規則。LLM を使わない経路なので、ここで機械的に決める。
// Deno 非依存。Vitest でテストする。
//
//  - 半角カナ → 全角カナ（「ｶﾝｺｸﾃﾞﾝﾄｳﾉﾘ」→「カンコクデントウノリ」）
//  - 割引行（負の金額）は直前の品目から引く
//  - 税抜表示のレシートは税率を掛けて税込に換算し、合計に合わせて端数を調整する
//  - カテゴリと支払方法はキーワードで推定する
// =====================================================================

const HANKAKU = 'ｦｧｨｩｪｫｬｭｮｯｰｱｲｳｴｵｶｷｸｹｺｻｼｽｾｿﾀﾁﾂﾃﾄﾅﾆﾇﾈﾉﾊﾋﾌﾍﾎﾏﾐﾑﾒﾓﾔﾕﾖﾗﾘﾙﾚﾛﾜﾝ';
const ZENKAKU = 'ヲァィゥェォャュョッーアイウエオカキクケコサシスセソタチツテトナニヌネノハヒフヘホマミムメモヤユヨラリルレロワン';
const DAKUTEN: Record<string, string> = {
  カ: 'ガ', キ: 'ギ', ク: 'グ', ケ: 'ゲ', コ: 'ゴ', サ: 'ザ', シ: 'ジ', ス: 'ズ', セ: 'ゼ', ソ: 'ゾ',
  タ: 'ダ', チ: 'ヂ', ツ: 'ヅ', テ: 'デ', ト: 'ド', ハ: 'バ', ヒ: 'ビ', フ: 'ブ', ヘ: 'ベ', ホ: 'ボ', ウ: 'ヴ',
};
const HANDAKUTEN: Record<string, string> = { ハ: 'パ', ヒ: 'ピ', フ: 'プ', ヘ: 'ペ', ホ: 'ポ' };

/** 半角カナを全角にし、濁点・半濁点を合成する。全角英数は半角に寄せる */
export function normalizeName(s: string): string {
  let out = '';
  for (const ch of s) {
    if (ch === 'ﾞ') { const last = out.slice(-1); out = out.slice(0, -1) + (DAKUTEN[last] ?? last + '゛'); continue; }
    if (ch === 'ﾟ') { const last = out.slice(-1); out = out.slice(0, -1) + (HANDAKUTEN[last] ?? last + '゜'); continue; }
    const i = HANKAKU.indexOf(ch);
    out += i >= 0 ? ZENKAKU[i] : ch;
  }
  return out
    .replace(/[Ａ-Ｚａ-ｚ０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
    .replace(/\s+/g, ' ')
    .trim();
}

/** キーワードからカテゴリを推定する。候補に無いカテゴリは返さない */
const CATEGORY_RULES: Array<[string, RegExp]> = [
  // 「薬用」は日用品（シェービングフォーム等）なので、日用品を医療費より先に見る
  ['日用品', /レジ袋|袋|ティッシュ|トイレ|洗剤|シャンプー|リンス|コンディショナー|ボディソープ|石鹸|せっけん|歯ブラシ|歯磨|シェービング|剃刀|カミソリ|除菌|ブルーレット|柔軟剤|ラップ|ホイル|電池|乾電池|スポンジ|ゴミ袋|綿棒|生理|ナプキン|ソフトパック|タオル|ハンガー|文具|ノート|ペン|薬用/],
  ['医療費', /錠|薬|サプリ|ビタミン|亜鉛|マカ|ビオ|マスク|絆創膏|湿布|目薬|のど飴|整腸|胃腸|漢方|体温計|コンタクト/],
  // 「バス」単体は ザバス・バスタオル に当たるので、乗り物として使われる形だけ拾う
  ['交通費', /切符|乗車券|定期券|タクシー|(^|\s)バス($|\s|代|料|運賃)|市バス|高速バス|ガソリン|給油|駐車|高速道路|ETC|ICOCA|Suica|PASMO|チャージ/],
  ['娯楽費', /ゲーム|映画|書籍|雑誌|コミック|マンガ|漫画|CD|DVD|チケット|ガチャ|くじ/],
  ['食費', /牛乳|パン|米|ごはん|ゴハン|弁当|おにぎり|サラダ|刺身|さしみ|肉|魚|野菜|果物|飲料|水|茶|コーヒー|珈琲|ジュース|コーラ|ビール|酒|ワイン|菓子|チョコ|ガム|アイス|ヨーグルト|卵|豆腐|納豆|麺|そば|うどん|ラーメン|カレー|のり|ノリ|ドーナツ|ケーキ|スープ|焼そば|焼きそば|ハム|ソーセージ|チーズ|バター|ドレッシング|調味|醤油|味噌|砂糖|塩|油|ザバス|プロテイン|ゼリー|グミ|せんべい|煎餅|クッキー|ポテト|スナック|ミネラル|ウォーター/],
];

/** 店名から既定カテゴリを決める（薬局で読めない品目は日用品に寄せる） */
export function defaultCategoryForStore(store: string | null, categories: string[]): string {
  const s = store ?? '';
  const pick = (c: string) => (categories.includes(c) ? c : null);
  if (/薬局|ドラッグ|ホームセンター|ダイソー|セリア|キャンドゥ|無印|ニトリ|カインズ|コーナン/.test(s)) {
    return pick('日用品') ?? pick('その他') ?? categories[0] ?? 'その他';
  }
  return pick('食費') ?? categories[0] ?? 'その他';
}

export function guessCategory(name: string, store: string | null, categories: string[]): string {
  for (const [cat, re] of CATEGORY_RULES) {
    if (re.test(name) && categories.includes(cat)) return cat;
  }
  return defaultCategoryForStore(store, categories);
}

/** レシート全文から支払方法を推定する */
export function guessPayment(content: string): '現金' | 'クレジット' | '電子マネー' | null {
  const c = content.replace(/\s+/g, '');
  if (/クレジット|credit|VISA|Master|JCB|AMEX|売上票/i.test(c)) return 'クレジット';
  if (/iD支払|QUICPay|電子金券|電子マネー|PayPay|楽天ペイ|d払い|auPAY|メルペイ|Suica|ICOCA|PASMO|WAON|nanaco|Edy|交通系/i.test(c)) return '電子マネー';
  if (/現金|お預り|お預かり|お釣り|釣銭/.test(c)) return '現金';
  return null;
}

export interface RawItem {
  name: string;
  amount: number;
  /** その行の原文（軽減税率の * 印を見るため） */
  line?: string;
}

export interface ReconcileResult {
  items: Array<{ name: string; amount: number }>;
  /** 換算・調整の内容。確認画面の注意書きに使う */
  note: string | null;
}

/**
 * OCR の明細を合計に合わせる。
 *  1. 負の金額（値引行）は直前の品目から引く
 *  2. 明細合計 = 合計 ならそのまま
 *  3. 明細合計 + 税額 ≈ 合計 なら税抜表示とみなし、* 印の品目は 8%、それ以外は 10% で税込に換算し、
 *     端数は最後の品目で合わせる。税率の印が取れなければ合計との比で按分する
 *  4. それ以外は触らず、ずれを note に書く（画面で直してもらう）
 */
/** 「2コX単360」「3個 x 100」のような数量行。品名ではなく直前の品目の数量・金額の内訳 */
const QUANTITY_LINE = /^\s*\d+\s*[コ個点]?\s*[xX×＊*]\s*単?\s*[\d,]+/;

export function reconcileItems(raw: RawItem[], total: number | null, totalTax: number | null): ReconcileResult {
  const items: Array<{ name: string; amount: number; line: string }> = [];
  const notes: string[] = [];
  for (const r of raw) {
    const amount = Math.round(r.amount);
    const name = normalizeName(r.name);
    const last = items[items.length - 1];
    if (amount < 0 || /値引|割引|引き$|^-/.test(name)) {
      // 値引行は直前の品目から引く。先頭に来た（品目を取りこぼした）ときは捨てずに残す
      if (last) last.amount += amount < 0 ? amount : -amount;
      else notes.push(`割引（${amount}円）の対象品目が読めませんでした。`);
      continue;
    }
    if (QUANTITY_LINE.test(name) && last) {
      // 数量行の金額が品目の金額（複数個の合計）。直前の品目に金額が無ければそれを採用する
      if (last.amount === 0) last.amount = amount;
      continue;
    }
    if (name === '') continue;
    items.push({ name, amount, line: r.line ?? '' });
  }
  const strip = (xs: typeof items) => xs.map(({ name, amount }) => ({ name, amount }));
  const joinNotes = (extra?: string) => [...notes, ...(extra ? [extra] : [])].join(' ') || null;
  if (items.length === 0 || total == null) return { items: strip(items), note: joinNotes() };

  const sum = items.reduce((s, i) => s + i.amount, 0);
  if (sum === total) return { items: strip(items), note: joinNotes() };

  // 税抜表示と判断するのは、税額の行で裏が取れたとき、または品目に軽減税率の印があるときだけ。
  // 「少し足りない」だけで按分すると、読み落とした品目の分まで他の品目に乗ってしまう
  const marked = items.some((i) => /[*＊※]/.test(i.line));
  const taxExcluded = (totalTax != null && Math.abs(sum + totalTax - total) <= 2)
    || (marked && sum < total && total - sum <= Math.round(sum * 0.11) + 2);
  if (taxExcluded) {
    let converted = items.map((i) => {
      const rate = marked ? (/[*＊※]/.test(i.line) ? 1.08 : 1.10) : total / sum;
      return { ...i, amount: Math.round(i.amount * rate) };
    });
    const residual = total - converted.reduce((s, i) => s + i.amount, 0);
    if (residual !== 0) {
      // 端数は最後の品目で吸収する。マイナスになるほど大きければ按分が間違っているので触らない
      const last = converted.length - 1;
      if (converted[last].amount + residual >= 0) {
        converted = converted.map((i, idx) => (idx === last ? { ...i, amount: i.amount + residual } : i));
      }
    }
    const finalSum = converted.reduce((s, i) => s + i.amount, 0);
    return {
      items: strip(converted),
      note: joinNotes(
        (marked ? '税抜表示のため税込に換算しました（* 印は 8%、無印は 10%）。' : '税抜表示のため合計に合わせて按分しました。')
        + (finalSum !== total ? ` それでも合計と ${finalSum - total} 円ずれています。` : ''),
      ),
    };
  }

  return { items: strip(items), note: joinNotes(`明細の合計（¥${sum.toLocaleString()}）がレシートの合計（¥${total.toLocaleString()}）と一致しません。読み落としや割引の可能性があります。`) };
}
