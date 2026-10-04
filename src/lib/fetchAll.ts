/**
 * PostgREST は1リクエスト1000行で打ち切る。半年・1年の分析では食事や支出が
 * これを超えるので、range で分割して全件取る（Edge Function の records.ts と同じ方式）。
 * 件数が欠けると平均が静かに狂い、グラフの端が消えるだけで気づけない。
 */
const PAGE = 1000;

type PageResult = { data: unknown; error: { message: string } | null };

export async function fetchAllRows<T>(
  build: (from: number, to: number) => PromiseLike<PageResult>,
): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await build(from, from + PAGE - 1);
    if (error) throw new Error(error.message);
    const rows = (data as T[]) ?? [];
    out.push(...rows);
    if (rows.length < PAGE) break;
  }
  return out;
}
