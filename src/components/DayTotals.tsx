import type { Nutrition, NutritionGoals } from '../lib/types';
import { fmt, pfcKcal } from '../lib/nutrition';

function GoalRow({
  label, current, target, unit, color,
}: { label: string; current: number; target: number; unit: string; color: string }) {
  const pct = target > 0 ? (current / target) * 100 : 0;
  const over = current > target;
  return (
    <div style={{ marginBottom: 8 }}>
      <div className="row-between" style={{ fontSize: 12, marginBottom: 3 }}>
        <span className="muted">{label}</span>
        <span>
          {fmt(current)} / {fmt(target)} {unit}{' '}
          <span style={{ color: over ? 'var(--danger)' : 'var(--muted)' }}>({Math.round(pct)}%)</span>
        </span>
      </div>
      <div style={{ height: 6, borderRadius: 999, background: 'var(--fill-2)', overflow: 'hidden' }}>
        <div style={{ width: `${Math.min(100, pct)}%`, height: '100%', background: over ? 'var(--danger)' : color }} />
      </div>
    </div>
  );
}

export default function DayTotals({ total, goals }: { total: Nutrition; goals?: NutritionGoals }) {
  const k = pfcKcal(total);
  const sum = k.protein + k.fat + k.carbohydrate;
  const pct = (v: number) => (sum > 0 ? (v / sum) * 100 : 0);

  const hasGoal = goals != null && (
    goals.target_calories != null || goals.target_protein != null ||
    goals.target_fat != null || goals.target_carbohydrate != null
  );

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

      {hasGoal && (
        <div style={{ marginTop: 14, borderTop: '1px solid var(--border)', paddingTop: 12 }}>
          <div className="muted" style={{ fontSize: 11, marginBottom: 8 }}>目標との比較</div>
          {goals!.target_calories != null && (
            <GoalRow label="カロリー" current={total.calories} target={goals!.target_calories} unit="kcal" color="var(--kcal)" />
          )}
          {goals!.target_protein != null && (
            <GoalRow label="たんぱく質" current={total.protein} target={goals!.target_protein} unit="g" color="var(--protein)" />
          )}
          {goals!.target_fat != null && (
            <GoalRow label="脂質" current={total.fat} target={goals!.target_fat} unit="g" color="var(--fat)" />
          )}
          {goals!.target_carbohydrate != null && (
            <GoalRow label="炭水化物" current={total.carbohydrate} target={goals!.target_carbohydrate} unit="g" color="var(--carb)" />
          )}
        </div>
      )}
    </div>
  );
}
