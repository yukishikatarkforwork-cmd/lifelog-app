// =====================================================================
// カード明細 CSV → 突き合わせ用 SQL。
// Google ドライブに置いた明細を Claude（Supabase MCP）で家計簿と突き合わせるときに使う。
// アプリ内の「取り込み」と同じパーサ・同じ取込キー・同じカテゴリ推定を使うので、
// どちらから入れても二重登録にならない。
//
//   npx tsx scripts/statement-sql.ts <csv> --card 三井住友カード --email you@example.com [--rules rules.json]
//
// 出力は 2 本の SQL（標準出力）:
//   1. REPORT … 明細にあって家計簿に無い行 / 家計簿にあって明細に無い同日同額（重複候補）/ 件数合計
//   2. IMPORT … 未登録の行だけを expenses に upsert（import_key の衝突は無視）
// SQL は auth.users から email でユーザーを引くので service role で流すこと。
// =====================================================================
import { readFileSync } from 'node:fs';
import { decodeStatement, parseStatement, buildImportKeys } from '../src/lib/statement.ts';
import { displayMerchant, guessMerchantCategory } from '../src/lib/merchant.ts';
import { DEFAULT_EXPENSE_CATEGORIES } from '../src/lib/types.ts';

function arg(name: string, fallback?: string): string {
  const i = process.argv.indexOf(`--${name}`);
  if (i >= 0 && process.argv[i + 1]) return process.argv[i + 1];
  if (fallback !== undefined) return fallback;
  console.error(`--${name} が必要です`);
  process.exit(1);
}

const file = process.argv[2];
if (!file || file.startsWith('--')) { console.error('使い方: npx tsx scripts/statement-sql.ts <csv> --card <カード名> --email <メール>'); process.exit(1); }
const card = arg('card', '三井住友カード');
const email = arg('email');
const rulesPath = arg('rules', '');
const rules: Array<{ pattern: string; category: string }> = rulesPath ? JSON.parse(readFileSync(rulesPath, 'utf-8')) : [];

const buf = readFileSync(file);
const text = decodeStatement(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer);
const parsed = parseStatement(text);
if (parsed.rows.length === 0) { console.error('明細として読める行がありません'); process.exit(2); }
const keys = buildImportKeys(card, parsed.rows);

const q = (s: string) => `'${s.replace(/'/g, "''")}'`;
const values = parsed.rows.map((r, i) => {
  const merchant = displayMerchant(r.merchant);
  const cat = guessMerchantCategory(r.merchant, rules, DEFAULT_EXPENSE_CATEGORIES);
  return `(${q(r.date)}::date, ${q(merchant)}, ${r.amount}, ${q(keys[i])}, ${q(cat)})`;
}).join(',\n  ');

const dates = parsed.rows.map((r) => r.date).sort();
const start = dates[0];
const end = dates[dates.length - 1];

console.log(`-- ===== REPORT (${parsed.rows.length} 行, ${start} 〜 ${end}, 読めなかった行 ${parsed.unparsed}) =====`);
console.log(`with u as (select id from auth.users where email = ${q(email)}),
stmt(date, merchant, amount, import_key, category) as (values
  ${values}
),
ex as (select * from public.expenses where user_id = (select id from u) and date between ${q(start)} and ${q(end)})
select 'A_明細にあって未登録' as kind, s.date, s.merchant, s.amount, s.category as note
  from stmt s where s.amount > 0 and not exists (select 1 from ex where ex.import_key = s.import_key)
union all
select 'B_同日同額の手入力あり（二重計上かも）', s.date, s.merchant, s.amount, ex.category || ' / ' || coalesce(ex.memo, '')
  from stmt s join ex on ex.date = s.date and round(ex.amount) = s.amount and ex.source <> 'card'
union all
select 'C_返金・調整', s.date, s.merchant, s.amount, null from stmt s where s.amount <= 0
union all
select 'Z_合計', null, '明細 ' || count(*) || ' 行 / 取り込み済み ' || count(*) filter (where exists (select 1 from ex where ex.import_key = s.import_key)) || ' 行',
  sum(amount) filter (where amount > 0), null from stmt s
order by 1, 2;`);

console.log(`\n-- ===== IMPORT (未登録の行だけ入れる。実行前に REPORT の B を確認) =====`);
console.log(`with u as (select id from auth.users where email = ${q(email)}),
stmt(date, merchant, amount, import_key, category) as (values
  ${values}
)
insert into public.expenses (user_id, date, amount, category, payment_method, memo, merchant, source, card_name, import_key)
select (select id from u), s.date, s.amount, s.category, 'クレジット', nullif(s.merchant, ''), nullif(s.merchant, ''), 'card', ${q(card)}, s.import_key
from stmt s where s.amount > 0
on conflict (user_id, import_key) do nothing
returning date, merchant, amount, category;`);
