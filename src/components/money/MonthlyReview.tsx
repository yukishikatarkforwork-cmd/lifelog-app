import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { todayStr, formatShort } from '../../lib/date';
import { displayMerchant, normalizeMerchant } from '../../lib/merchant';
import { subscriptionTotalInMonth } from '../../lib/subscriptions';
import type { Expense } from '../../lib/types';
import type { MoneyData } from '../../pages/MoneyPage';

const yen = (n: number) => `¥${Math.round(n).toLocaleString()}`;
const signed = (n: number) => (n > 0 ? `+${yen(n)}` : n < 0 ? `-${yen(-n)}` : '±0');

function shiftMonth(month: string, delta: number): string {
  const [y, m] = month.split('-').map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}
function monthLabel(month: string): string {
  const [y, m] = month.split('-').map(Number);
  return `${y}年${m}月`;
}
function merchantOf(e: Expense): string {
  const m = e.merchant?.trim() || e.memo?.trim() || '';
  return m ? displayMerchant(m) : `(${e.category})`;
}

interface Agg { total: number; count: number }
function groupBy(es: Expense[], key: (e: Expense) => string): Map<string, Agg & { label: string }> {
  const map = new Map<string, Agg & { label: string }>();
  for (const e of es) {
    const k = key(e);
    const cur = map.get(k) ?? { total: 0, count: 0, label: k };
    cur.total += e.amount;
    cur.count += 1;
    map.set(k, cur);
  }
  return map;
}

/**
 * 月ごとの振り返り。前月と比べて何が増えたか、どの店に何回使ったか、単発の大きな買い物は何か。
 * 「無駄遣いを減らす」ための画面なので、合計より「回数の多い小さな出費」と「増えたカテゴリ」を前に出す。
 */
export default function MonthlyReview({ data, onGoImport, onGoSubs }: { data: MoneyData; onGoImport: () => void; onGoSubs: () => void }) {
  const navigate = useNavigate();
  const [month, setMonth] = useState(() => todayStr().slice(0, 7));
  const prev = shiftMonth(month, -1);

  const r = useMemo(() => {
    const inMonth = (m: string) => data.expenses.filter((e) => e.date.startsWith(m) && e.amount > 0);
    const cur = inMonth(month);
    const last = inMonth(prev);
    const total = cur.reduce((s, e) => s + e.amount, 0);
    const lastTotal = last.reduce((s, e) => s + e.amount, 0);
    const card = cur.filter((e) => e.source === 'card');
    const cardTotal = card.reduce((s, e) => s + e.amount, 0);

    const byCat = groupBy(cur, (e) => e.category);
    const lastByCat = groupBy(last, (e) => e.category);
    const categories = [...new Set([...byCat.keys(), ...lastByCat.keys()])]
      .map((c) => ({ category: c, total: byCat.get(c)?.total ?? 0, count: byCat.get(c)?.count ?? 0, last: lastByCat.get(c)?.total ?? 0 }))
      .sort((a, b) => b.total - a.total);

    const merchantKey = (e: Expense) => normalizeMerchant(merchantOf(e)) || merchantOf(e);
    const byMerchant = [...groupBy(cur, merchantKey).entries()]
      .map(([k, v]) => ({ key: k, total: v.total, count: v.count, label: merchantOf(cur.find((e) => merchantKey(e) === k)!) }));
    const topMerchants = [...byMerchant].sort((a, b) => b.total - a.total).slice(0, 8);
    const frequent = byMerchant.filter((m) => m.count >= 3).sort((a, b) => b.count - a.count).slice(0, 8);
    const big = [...cur].sort((a, b) => b.amount - a.amount).slice(0, 5);
    const subsTotal = subscriptionTotalInMonth(data.subscriptions, data.expenses, month);
    const days = new Set(cur.map((e) => e.date)).size;
    return { cur, total, lastTotal, cardTotal, categories, topMerchants, frequent, big, subsTotal, days };
  }, [data.expenses, data.subscriptions, month, prev]);

  const askAi = () => {
    const [y, m] = month.split('-').map(Number);
    const start = `${month}-01`;
    const end = todayStr() < `${month}-31` ? todayStr() : `${y}-${String(m).padStart(2, '0')}-${new Date(y, m, 0).getDate()}`;
    const days = Math.round((Date.parse(end) - Date.parse(start)) / 86400000) + 1 + 31; // 前月も比較対象に含める
    navigate('/ask', {
      state: {
        question: `${monthLabel(month)}の支出を振り返りたい。前月と比べて増えたカテゴリと店、回数の多い小さな出費、サブスクの合計を挙げて、来月に減らせそうなところを具体的に3つ提案して。`,
        days,
      },
    });
  };

  return (
    <>
      <div className="card">
        <div className="row-between">
          <button className="btn ghost small" onClick={() => setMonth(shiftMonth(month, -1))} aria-label="前の月">‹</button>
          <h2 style={{ margin: 0 }}>{monthLabel(month)}</h2>
          <button className="btn ghost small" onClick={() => setMonth(shiftMonth(month, 1))} disabled={month >= todayStr().slice(0, 7)} aria-label="次の月">›</button>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 8, marginTop: 12 }}>
          {[
            { label: '支出合計', value: yen(r.total), sub: `前月 ${yen(r.lastTotal)}（${signed(r.total - r.lastTotal)}）` },
            { label: 'うちカード', value: yen(r.cardTotal), sub: `${r.cur.filter((e) => e.source === 'card').length} 件` },
            { label: 'サブスク', value: yen(r.subsTotal), sub: '台帳に登録したものの請求分' },
            { label: '記録のある日', value: `${r.days} 日`, sub: `${r.cur.length} 件` },
          ].map((s) => (
            <div key={s.label} style={{ background: 'var(--fill-2)', borderRadius: 10, padding: '10px 12px' }}>
              <div className="muted" style={{ fontSize: 11 }}>{s.label}</div>
              <div style={{ fontSize: 18, fontWeight: 700 }}>{s.value}</div>
              <div className="muted" style={{ fontSize: 11 }}>{s.sub}</div>
            </div>
          ))}
        </div>
        {r.cur.length === 0 && (
          <div className="muted" style={{ fontSize: 13, marginTop: 12 }}>
            この月の支出がありません。<button className="link-btn" onClick={onGoImport}>カード明細を取り込む</button>か、「今日」画面で記録してください。
          </div>
        )}
        <div className="grid-2" style={{ marginTop: 12 }}>
          <button className="btn outline" onClick={onGoSubs}>サブスクを見直す</button>
          <button className="btn" onClick={askAi} disabled={r.cur.length === 0}>AI に相談する</button>
        </div>
      </div>

      {r.categories.length > 0 && (
        <div className="card">
          <h2>カテゴリ別 <span className="muted" style={{ fontSize: 12, fontWeight: 400 }}>前月比</span></h2>
          {r.categories.map((c) => {
            const pct = r.total > 0 ? Math.round(c.total / r.total * 100) : 0;
            const diff = c.total - c.last;
            return (
              <div key={c.category} style={{ padding: '6px 0' }}>
                <div className="row-between" style={{ fontSize: 13 }}>
                  <span><strong>{c.category}</strong> <span className="muted">{c.count} 件</span></span>
                  <span>{yen(c.total)} <span className="muted" style={{ fontSize: 12, color: diff > 0 ? 'var(--danger)' : undefined }}>{signed(diff)}</span></span>
                </div>
                <div style={{ height: 6, background: 'var(--fill-2)', borderRadius: 3, marginTop: 4 }}>
                  <div style={{ width: `${pct}%`, height: '100%', background: 'var(--primary)', borderRadius: 3 }} />
                </div>
              </div>
            );
          })}
        </div>
      )}

      {r.frequent.length > 0 && (
        <div className="card">
          <h2>回数の多い出費 <span className="muted" style={{ fontSize: 12, fontWeight: 400 }}>月3回以上</span></h2>
          <p className="muted" style={{ fontSize: 12, marginTop: 0 }}>1回は小さくても積み上がる。コンビニ・カフェ・配達が上に来やすい。</p>
          {r.frequent.map((m) => (
            <div className="entry" key={m.key}>
              <div className="main"><div className="name" style={{ overflowWrap: 'anywhere' }}>{m.label}</div><div className="sub">{m.count} 回 ・ 1回平均 {yen(m.total / m.count)}</div></div>
              <div className="kcal" style={{ color: 'var(--text)' }}>{yen(m.total)}</div>
            </div>
          ))}
        </div>
      )}

      {r.topMerchants.length > 0 && (
        <div className="card">
          <h2>店別トップ</h2>
          {r.topMerchants.map((m) => (
            <div className="entry" key={m.key}>
              <div className="main"><div className="name" style={{ overflowWrap: 'anywhere' }}>{m.label}</div><div className="sub">{m.count} 件</div></div>
              <div className="kcal" style={{ color: 'var(--text)' }}>{yen(m.total)}</div>
            </div>
          ))}
        </div>
      )}

      {r.big.length > 0 && (
        <div className="card">
          <h2>大きな買い物</h2>
          {r.big.map((e) => (
            <div className="entry" key={e.id}>
              <Link to={`/day/${e.date}`} className="main" style={{ textDecoration: 'none', color: 'inherit' }}>
                <div className="name" style={{ overflowWrap: 'anywhere' }}>{merchantOf(e)}</div>
                <div className="sub">{formatShort(e.date)} ・ {e.category}{e.card_name ? ` ・ ${e.card_name}` : ''}</div>
              </Link>
              <div className="kcal" style={{ color: 'var(--text)' }}>{yen(e.amount)}</div>
            </div>
          ))}
        </div>
      )}
    </>
  );
}
