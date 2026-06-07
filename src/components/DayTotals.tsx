import type { Nutrition } from '../lib/types';
import { fmt, pfcKcal } from '../lib/nutrition';

export default function DayTotals({ total }: { total: Nutrition }) {
  const k = pfcKcal(total);
  const sum = k.protein + k.fat + k.carbohydrate;
  const pct = (v: number) => (sum > 0 ? (v / sum) * 100 : 0);

  return (
    <div className="card">
      <div className="totals">
        <div className="cell kcal">
          <div className="label">カロリー</div>
          <div className="value" data-testid="total-calories">{fmt(total.calories)}</div>
          <div className="unit">kcal</div>
        </div>
        <div className="cell p">
          <div className="label">たんぱく質</div>
          <div className="value">{fmt(total.protein)}</div>
          <div className="unit">g</div>
        </div>
        <div className="cell f">
          <div className="label">脂質</div>
          <div className="value">{fmt(total.fat)}</div>
          <div className="unit">g</div>
        </div>
        <div className="cell c">
          <div className="label">炭水化物</div>
          <div className="value">{fmt(total.carbohydrate)}</div>
          <div className="unit">g</div>
        </div>
      </div>

      {sum > 0 && (
        <>
          <div className="pfc-bar">
            <div className="seg p" style={{ width: `${pct(k.protein)}%` }} />
            <div className="seg f" style={{ width: `${pct(k.fat)}%` }} />
            <div className="seg c" style={{ width: `${pct(k.carbohydrate)}%` }} />
          </div>
          <div className="pfc-legend">
            <span><span className="dot" style={{ background: 'var(--protein)' }} />P {Math.round(pct(k.protein))}%</span>
            <span><span className="dot" style={{ background: 'var(--fat)' }} />F {Math.round(pct(k.fat))}%</span>
            <span><span className="dot" style={{ background: 'var(--carb)' }} />C {Math.round(pct(k.carbohydrate))}%</span>
          </div>
        </>
      )}
    </div>
  );
}
