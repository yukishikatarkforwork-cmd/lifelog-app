import { supabase, supabaseUrl } from './supabase';

/** Edge Function を叩く。supabase-js の invoke はストリームを扱えないので fetch を使う */
export async function callFunction(
  name: string,
  body: unknown,
  signal?: AbortSignal,
): Promise<Response> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error('ログインが必要です。');

  return fetch(`${supabaseUrl}/functions/v1/${name}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${session.access_token}`,
    },
    body: JSON.stringify(body),
    signal,
  });
}

export interface ReindexResult {
  indexed: number;
  deleted: number;
  skipped: number;
  remaining: number;
}

/**
 * 検索インデックスを作り直す。
 * Edge Function は1回あたりの件数を上限で切るので、残りがなくなるまで呼び直す。
 */
export async function reindex(opts: { dates?: string[]; maxCalls?: number } = {}): Promise<ReindexResult> {
  const maxCalls = opts.maxCalls ?? 20;
  const total: ReindexResult = { indexed: 0, deleted: 0, skipped: 0, remaining: 0 };

  for (let i = 0; i < maxCalls; i++) {
    const res = await callFunction('reindex', opts.dates ? { dates: opts.dates } : {});
    if (!res.ok) {
      const body = await res.json().catch(() => null);
      throw new Error(body?.error ?? `インデックスの更新に失敗しました (${res.status})`);
    }
    const r = await res.json() as ReindexResult;
    total.indexed += r.indexed ?? 0;
    total.deleted += r.deleted ?? 0;
    total.skipped += r.skipped ?? 0;
    total.remaining = r.remaining ?? 0;
    if (total.remaining === 0) break;
  }
  return total;
}

/**
 * 日記を保存・削除した直後に呼ぶ。
 * 失敗しても記録自体は保存できているので、UI は止めずコンソールに出すだけにする
 * （インデックスは設定画面の「作り直す」か、次回の再インデックスで自己修復する）。
 */
export function reindexInBackground(dates: string[]): void {
  void reindex({ dates }).catch((e) => {
    console.warn('[lifelog] 検索インデックスの更新に失敗しました:', e);
  });
}

export interface SimilarDay {
  date: string;
  content: string;
  similarity: number;
}

/** 指定日と似た日を返す（DB内で完結するので埋め込みAPIは呼ばない） */
export async function fetchSimilarDays(date: string, count = 5): Promise<SimilarDay[]> {
  const { data, error } = await supabase.rpc('similar_days', { p_date: date, match_count: count });
  if (error) throw new Error(error.message);
  return (data as SimilarDay[]) ?? [];
}
