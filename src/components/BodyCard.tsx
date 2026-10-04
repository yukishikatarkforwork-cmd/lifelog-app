import { useState } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';
import type { BodyRecord } from '../lib/types';
import { parseNum } from '../lib/nutrition';
import { useReload } from '../lib/useReload';
import { fetchHealthPlanetStatus, fmtKg, fmtPct, syncHealthPlanet } from '../lib/body';
import { IconScale } from './icons';

const fmtTime = (iso: string) =>
  new Date(iso).toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' });

/**
 * 体重・体組成（1日1件）。
 * Health Planet と連携していれば同期した値が入り、していなければ手入力する。
 * 手入力した日は同期で上書きされない（source='manual' のため）。
 */
export default function BodyCard({ date }: { date: string }) {
  const { user } = useAuth();
  const [record, setRecord] = useState<BodyRecord | null>(null);
  const [weight, setWeight] = useState('');
  const [fat, setFat] = useState('');
  const [editing, setEditing] = useState(false);
  const [connected, setConnected] = useState(false);
  const [saving, setSaving] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [saved, setSaved] = useState(false);
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');

  const reload = useReload(async () => {
    const [{ data }, status] = await Promise.all([
      supabase.from('body_records').select('*').eq('user_id', user?.id ?? '').eq('date', date).maybeSingle(),
      fetchHealthPlanetStatus().catch(() => null),
    ]);
    const r = data as BodyRecord | null;
    setRecord(r);
    setWeight(r?.weight_kg?.toString() ?? '');
    setFat(r?.body_fat_pct?.toString() ?? '');
    setConnected(status?.connected ?? false);
    // 同期済みの値がある日は閲覧表示、無ければ最初から入力欄を出す
    setEditing(!r);
    setSaved(false);
    setMsg('');
  }, [date]);

  const save = async () => {
    if (!user) return;
    const w = parseNum(weight);
    const f = parseNum(fat);
    if (w != null && (w <= 0 || w >= 500)) { setErr('体重は 0〜500 kg の範囲で入力してください。'); return; }
    if (f != null && (f < 0 || f > 100)) { setErr('体脂肪率は 0〜100 % の範囲で入力してください。'); return; }
    setSaving(true);
    setErr('');
    const { error } = await supabase.from('body_records').upsert(
      {
        user_id: user.id, date,
        weight_kg: w, body_fat_pct: f,
        // 手入力に切り替えたら同期由来の他の項目は保持しつつ、以降は同期で上書きさせない
        source: 'manual', measured_at: null,
      },
      { onConflict: 'user_id,date' },
    );
    setSaving(false);
    if (error) { setErr(error.message); return; }
    setSaved(true);
    setTimeout(() => setSaved(false), 1500);
    await reload();
  };

  const remove = async () => {
    if (!user || !record) return;
    if (!confirm('この日の体重記録を削除しますか？')) return;
    const { error } = await supabase.from('body_records').delete().eq('user_id', user.id).eq('date', date);
    if (error) { setErr(error.message); return; }
    await reload();
  };

  const sync = async () => {
    setSyncing(true);
    setErr('');
    setMsg('');
    try {
      const n = await syncHealthPlanet();
      setMsg(n === 0 ? 'Health Planet に新しい測定はありませんでした。' : `${n} 日分を取り込みました。`);
      await reload();
    } catch (e) {
      setErr(e instanceof Error ? e.message : '同期に失敗しました');
    } finally {
      setSyncing(false);
    }
  };

  const hasValue = record != null && (record.weight_kg != null || record.body_fat_pct != null);
  const details: Array<[string, string]> = record
    ? ([
      ['筋肉量', record.muscle_kg != null ? fmtKg(record.muscle_kg) : null],
      ['内臓脂肪', record.visceral_fat_level != null ? `レベル ${record.visceral_fat_level}` : null],
      ['基礎代謝', record.basal_metabolism_kcal != null ? `${Math.round(record.basal_metabolism_kcal)} kcal` : null],
      ['体内年齢', record.body_age != null ? `${record.body_age} 歳` : null],
      ['推定骨量', record.bone_kg != null ? fmtKg(record.bone_kg) : null],
    ] as Array<[string, string | null]>).filter((d): d is [string, string] => d[1] != null)
    : [];

  return (
    <div className="card">
      <div className="section-title">
        <h2><IconScale /> 体重</h2>
        {connected && (
          <button className="btn small outline" onClick={() => void sync()} disabled={syncing}>
            {syncing ? '同期中…' : 'Health Planet と同期'}
          </button>
        )}
      </div>
      {msg && <div className="info-box">{msg}</div>}
      {err && <div className="error-box">{err}</div>}

      {!editing && hasValue ? (
        <>
          <div className="totals" style={{ marginBottom: 8 }}>
            <div className="cell">
              <div className="muted" style={{ fontSize: 11 }}>体重</div>
              <div className="value">{fmtKg(record!.weight_kg)}</div>
            </div>
            <div className="cell">
              <div className="muted" style={{ fontSize: 11 }}>体脂肪率</div>
              <div className="value">{fmtPct(record!.body_fat_pct)}</div>
            </div>
          </div>
          {details.length > 0 && (
            <div className="muted" style={{ fontSize: 12, lineHeight: 1.8 }}>
              {details.map(([k, v]) => `${k} ${v}`).join(' / ')}
            </div>
          )}
          <div className="row-between" style={{ marginTop: 6 }}>
            <span className="muted" style={{ fontSize: 11 }}>
              {record!.source === 'healthplanet'
                ? `Health Planet から取り込み${record!.measured_at ? `（${fmtTime(record!.measured_at)} 測定）` : ''}`
                : '手入力'}
            </span>
            <span>
              <button className="link-btn" style={{ fontSize: 12 }} onClick={() => setEditing(true)}>編集</button>
              <button className="link-btn" style={{ fontSize: 12, marginLeft: 12 }} onClick={() => void remove()}>削除</button>
            </span>
          </div>
        </>
      ) : (
        <>
          <div className="grid-2">
            <div className="field">
              <label>体重 (kg)</label>
              <input data-testid="body-weight" type="number" inputMode="decimal" step="0.1" value={weight} onChange={(e) => setWeight(e.target.value)} placeholder="例: 62.4" />
            </div>
            <div className="field">
              <label>体脂肪率 (%)</label>
              <input type="number" inputMode="decimal" step="0.1" value={fat} onChange={(e) => setFat(e.target.value)} placeholder="例: 18.5" />
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button data-testid="body-save" className="btn full" onClick={() => void save()} disabled={saving || (weight === '' && fat === '')}>
              {saving ? '保存中…' : saved ? '保存しました ✓' : '体重を保存'}
            </button>
            {hasValue && (
              <button className="btn outline" onClick={() => { setEditing(false); setErr(''); }}>戻る</button>
            )}
          </div>
          {!connected && !hasValue && (
            <p className="muted" style={{ fontSize: 12, marginBottom: 0 }}>
              タニタの体組成計をお使いなら、<Link to="/settings">設定</Link>で Health Planet と連携すると自動で入ります。
            </p>
          )}
        </>
      )}
    </div>
  );
}
