import { supabase } from './supabase';
import { addDays } from './date';
import { currentUserId } from './own';
import type { Trip, TripChecklistItem, TripItem, TripItemKind } from './types';

/**
 * 旅のしおり。
 *
 * これまでの機能が「過去の記録（user × date）」なのに対し、しおりは
 * 「未来の計画（期間）」なので独立した概念として扱う。
 * ただし旅行が終わると、同じ期間の日記・写真・支出が既にあるので、
 * しおりはそのまま旅の記録として読めるようになる。
 */

/** 旅行の日付を配列で返す */
export function tripDates(trip: Pick<Trip, 'start_date' | 'end_date'>): string[] {
  const out: string[] = [];
  for (let d = trip.start_date; d <= trip.end_date; d = addDays(d, 1)) {
    out.push(d);
    if (out.length > 60) break; // 異常なデータで無限ループしないための保険
  }
  return out;
}

/** 「2泊3日」のような表示 */
export function tripLengthLabel(trip: Pick<Trip, 'start_date' | 'end_date'>): string {
  const days = tripDates(trip).length;
  return days <= 1 ? '日帰り' : `${days - 1}泊${days}日`;
}

export async function listTrips(): Promise<Trip[]> {
  // 共有されたしおりも RLS 上は見えるが、一覧に混ぜると編集できないものが並ぶので自分の分だけ
  const { data, error } = await supabase
    .from('trips').select('*').eq('user_id', await currentUserId()).order('start_date', { ascending: false });
  if (error) throw new Error(error.message);
  return (data as Trip[]) ?? [];
}

export async function getTrip(id: string): Promise<Trip | null> {
  const { data, error } = await supabase.from('trips').select('*').eq('id', id).maybeSingle();
  if (error) throw new Error(error.message);
  return (data as Trip | null) ?? null;
}

export async function createTrip(userId: string, input: {
  title: string; destination: string; start_date: string; end_date: string; budget: string;
}): Promise<Trip> {
  const title = input.title.trim();
  if (title === '') throw new Error('タイトルを入力してください。');
  if (!input.start_date || !input.end_date) throw new Error('日程を入力してください。');
  if (input.start_date > input.end_date) throw new Error('開始日が終了日より後になっています。');

  const budget = input.budget.trim() === '' ? null : Number(input.budget);
  if (budget != null && !Number.isFinite(budget)) throw new Error('予算は数値で入力してください。');

  const { data, error } = await supabase.from('trips').insert({
    user_id: userId,
    title,
    destination: input.destination.trim() || null,
    start_date: input.start_date,
    end_date: input.end_date,
    budget,
  }).select().single();
  if (error) throw new Error(error.message);
  return data as Trip;
}

export async function updateTrip(id: string, patch: Partial<Trip>): Promise<void> {
  const { error } = await supabase.from('trips').update(patch).eq('id', id);
  if (error) throw new Error(error.message);
}

export async function deleteTrip(id: string): Promise<void> {
  // trip_items / trip_checklist は on delete cascade で一緒に消える
  const { error } = await supabase.from('trips').delete().eq('id', id);
  if (error) throw new Error(error.message);
}

// ---------- 予定 ----------

export async function listItems(tripId: string): Promise<TripItem[]> {
  const { data, error } = await supabase
    .from('trip_items').select('*').eq('trip_id', tripId)
    .order('date').order('start_time', { nullsFirst: false }).order('sort_order');
  if (error) throw new Error(error.message);
  return (data as TripItem[]) ?? [];
}

export async function addItem(userId: string, tripId: string, input: {
  date: string; start_time: string; kind: TripItemKind;
  title: string; place: string; url: string; memo: string; cost: string;
}): Promise<void> {
  const title = input.title.trim();
  if (title === '') throw new Error('予定の内容を入力してください。');

  const cost = input.cost.trim() === '' ? null : Number(input.cost);
  if (cost != null && !Number.isFinite(cost)) throw new Error('費用は数値で入力してください。');

  const { error } = await supabase.from('trip_items').insert({
    user_id: userId, trip_id: tripId,
    date: input.date,
    start_time: input.start_time || null,
    kind: input.kind,
    title,
    place: input.place.trim() || null,
    url: input.url.trim() || null,
    memo: input.memo.trim() || null,
    cost,
  });
  if (error) throw new Error(error.message);
}

export async function deleteItem(id: string): Promise<void> {
  const { error } = await supabase.from('trip_items').delete().eq('id', id);
  if (error) throw new Error(error.message);
}

// ---------- 持ち物 ----------

export async function listChecklist(tripId: string): Promise<TripChecklistItem[]> {
  const { data, error } = await supabase
    .from('trip_checklist').select('*').eq('trip_id', tripId)
    .order('sort_order').order('created_at');
  if (error) throw new Error(error.message);
  return (data as TripChecklistItem[]) ?? [];
}

export async function addChecklistItems(userId: string, tripId: string, texts: string[]): Promise<void> {
  const rows = texts
    .map((t) => t.trim())
    .filter((t) => t !== '')
    .map((text, i) => ({ user_id: userId, trip_id: tripId, text, sort_order: i }));
  if (rows.length === 0) return;
  const { error } = await supabase.from('trip_checklist').insert(rows);
  if (error) throw new Error(error.message);
}

export async function toggleChecklistItem(id: string, checked: boolean): Promise<void> {
  const { error } = await supabase.from('trip_checklist').update({ checked }).eq('id', id);
  if (error) throw new Error(error.message);
}

export async function deleteChecklistItem(id: string): Promise<void> {
  const { error } = await supabase.from('trip_checklist').delete().eq('id', id);
  if (error) throw new Error(error.message);
}

// ---------- 実績 ----------

/** 旅行期間の実際の支出（予算と並べて出す） */
export async function fetchActualCost(tripId: string): Promise<number> {
  const { data, error } = await supabase.rpc('trip_actual_cost', { p_trip_id: tripId });
  if (error) throw new Error(error.message);
  return Number(data ?? 0);
}
