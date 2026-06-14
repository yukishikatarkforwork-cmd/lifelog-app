import { useCallback, useEffect, useRef, type DependencyList } from 'react';

/**
 * deps が変化するたびに非同期ローダーを実行し、手動で再実行できる reload を返す小さなフック。
 *
 * ローダーは ref 経由で常に最新のクロージャを参照するので、deps には「いつ再取得するか」
 * （日付・ユーザーなど）だけを渡せばよい。各画面に散っていた
 * `const load = useCallback(...); useEffect(() => void load(), [load])` の定型を一本化する。
 */
export function useReload(loader: () => Promise<void>, deps: DependencyList): () => Promise<void> {
  const loaderRef = useRef(loader);

  // 最新の loader クロージャを ref に保持する（render 中ではなくコミット後に更新）。
  // 宣言順で下の取得 effect より先に走るため、再取得時には常に最新の loader が使われる。
  useEffect(() => {
    loaderRef.current = loader;
  });

  const reload = useCallback(() => loaderRef.current(), []);

  useEffect(() => {
    void reload();
    // deps が変わったときだけ再取得する（loader 本体は ref で最新を参照するため deps に含めない）
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  return reload;
}
