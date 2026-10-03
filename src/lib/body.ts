import { supabase } from './supabase';
import { callFunction } from './ai';
import type { HealthPlanetStatus } from './types';

/**
 * 体重・体組成と、タニタ Health Planet 連携のクライアント側。
 *
 * OAuth の code → token 交換と測定データの取得は Edge Function `healthplanet` に任せる。
 * client_secret とアクセストークンをブラウザに置かないためで、
 * ここでやるのは「認可画面へ飛ばす」「戻ってきた code を渡す」「同期を頼む」だけ。
 */

/** 認可後に戻ってくる先。Health Planet 側のアプリ登録でこの URL を指定する */
export const HEALTHPLANET_CALLBACK_PATH = '/settings/healthplanet';

/** 認可画面に飛ぶ前に控えておく state（戻ってきたときに照合する） */
const STATE_KEY = 'lifelog.healthplanet.state';

export class HealthPlanetError extends Error {
  /** true なら連携が切れている（再連携が必要） */
  reconnect: boolean;
  constructor(message: string, reconnect = false) {
    super(message);
    this.reconnect = reconnect;
  }
}

export function callbackUrl(): string {
  return `${window.location.origin}${HEALTHPLANET_CALLBACK_PATH}`;
}

async function call<T>(body: Record<string, unknown>): Promise<T> {
  const res = await callFunction('healthplanet', body);
  const data = await res.json().catch(() => null) as (T & { error?: string; reconnect?: boolean }) | null;
  if (!res.ok) {
    throw new HealthPlanetError(data?.error ?? `Health Planet 連携に失敗しました (${res.status})`, data?.reconnect === true);
  }
  return data as T;
}

export async function fetchHealthPlanetStatus(): Promise<HealthPlanetStatus> {
  const { data, error } = await supabase.rpc('healthplanet_status');
  if (error) throw new Error(error.message);
  const row = (data as HealthPlanetStatus[] | null)?.[0];
  return row ?? { connected: false, connected_at: null, last_synced_at: null, last_error: null, token_expires_at: null };
}

/** 認可画面の URL を取得して遷移する */
export async function startHealthPlanetAuth(): Promise<void> {
  const state = crypto.randomUUID();
  try { sessionStorage.setItem(STATE_KEY, state); } catch { /* プライベートモード等では照合を諦める */ }
  const { url } = await call<{ url: string }>({ action: 'auth_url', redirect_uri: callbackUrl(), state });
  window.location.assign(url);
}

export interface ConnectResult {
  connected: boolean;
  synced: number;
  warning?: string;
}

/** 認可画面から戻ってきた code をトークンに交換し、過去分を取り込む */
export async function completeHealthPlanetAuth(code: string, returnedState: string | null): Promise<ConnectResult> {
  let expected: string | null = null;
  try { expected = sessionStorage.getItem(STATE_KEY); sessionStorage.removeItem(STATE_KEY); } catch { /* 照合なし */ }
  // Health Planet が state を返す場合だけ照合する（返さない場合は code を本人のセッションで交換する以上の対策はできない）
  if (returnedState && expected && returnedState !== expected) {
    throw new HealthPlanetError('認可の照合に失敗しました。もう一度「連携する」からやり直してください。');
  }
  return call<ConnectResult>({ action: 'connect', code, redirect_uri: callbackUrl() });
}

/** 前回同期以降の測定を取り込む。full=true で過去1年分を引き直す */
export async function syncHealthPlanet(full = false): Promise<number> {
  const { synced } = await call<{ synced: number }>({ action: 'sync', full });
  return synced;
}

export async function disconnectHealthPlanet(): Promise<void> {
  await call<{ connected: boolean }>({ action: 'disconnect' });
}

/** 「今日」画面を開いたときの自動同期を、この間隔より詰めて走らせない */
const AUTO_SYNC_INTERVAL_MS = 60 * 60 * 1000;
const AUTO_SYNC_KEY = 'lifelog.healthplanet.lastAutoSync';

/**
 * 連携済みなら、1時間に1回だけ裏で同期する。
 * 失敗しても画面は止めない（設定画面の連携カードに last_error が出る）。
 */
export async function autoSyncHealthPlanet(): Promise<boolean> {
  let last = 0;
  try { last = Number(localStorage.getItem(AUTO_SYNC_KEY) ?? 0); } catch { /* 読めなければ毎回 */ }
  if (Date.now() - last < AUTO_SYNC_INTERVAL_MS) return false;

  const status = await fetchHealthPlanetStatus().catch(() => null);
  if (!status?.connected) return false;

  try { localStorage.setItem(AUTO_SYNC_KEY, String(Date.now())); } catch { /* 無視 */ }
  try {
    return (await syncHealthPlanet()) > 0;
  } catch (e) {
    console.warn('[lifelog] Health Planet の自動同期に失敗しました:', e);
    return false;
  }
}

export const fmtKg = (v: number | null | undefined): string => (v == null ? '—' : `${Number(v).toFixed(1)} kg`);
export const fmtPct = (v: number | null | undefined): string => (v == null ? '—' : `${Number(v).toFixed(1)} %`);
