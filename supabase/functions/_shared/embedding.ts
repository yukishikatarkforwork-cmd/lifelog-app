// =====================================================================
// 埋め込み（ベクトル化）の共通処理
//
// 既定は OpenAI の text-embedding-3-small。日本語の意味検索で実用的な精度が出て、
// 1M トークンあたり $0.02 と安い（日記1年分でも1円未満）。
// dimensions=512 に落としているのは、精度をほぼ保ったままインデックスを小さくするため。
//
// 別のプロバイダに替えたい場合は embed() の中だけを差し替えればよい。
//  - Voyage AI (voyage-3-lite): 多言語に強い。https://api.voyageai.com/v1/embeddings
//  - Supabase 内蔵 gte-small   : APIキー不要・無料だが英語寄りで日本語の精度は落ちる
// 差し替えるときは schema.sql の vector(512) と EMBEDDING_DIM も合わせること。
// =====================================================================

export { chunkText } from './chunk.ts';

export const EMBEDDING_DIM = 512;

const EMBEDDING_MODEL = 'text-embedding-3-small';
const EMBEDDING_ENDPOINT = 'https://api.openai.com/v1/embeddings';

/** 一度に投げる本数。多すぎるとリクエストが大きくなりすぎる */
const BATCH_SIZE = 64;

export class EmbeddingError extends Error {}

/** テキストの配列をベクトルの配列にする（順序は入力と対応） */
export async function embed(texts: string[]): Promise<number[][]> {
  if (texts.length === 0) return [];

  const apiKey = Deno.env.get('OPENAI_API_KEY');
  if (!apiKey) {
    throw new EmbeddingError(
      'OPENAI_API_KEY が未設定です。`supabase secrets set OPENAI_API_KEY=sk-...` を実行してください。',
    );
  }

  const out: number[][] = [];
  for (let i = 0; i < texts.length; i += BATCH_SIZE) {
    const batch = texts.slice(i, i + BATCH_SIZE);
    const res = await fetch(EMBEDDING_ENDPOINT, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: EMBEDDING_MODEL,
        dimensions: EMBEDDING_DIM,
        // 空文字はエラーになるので念のため潰す
        input: batch.map((t) => (t.trim() === '' ? '(空)' : t)),
      }),
    });

    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      throw new EmbeddingError(`埋め込みの生成に失敗しました (${res.status}): ${detail.slice(0, 300)}`);
    }

    const body = await res.json() as { data: Array<{ index: number; embedding: number[] }> };
    // index 順に並べ直す（API は順序を保証していない）
    const sorted = [...body.data].sort((a, b) => a.index - b.index);
    for (const d of sorted) out.push(d.embedding);
  }

  if (out.length !== texts.length) {
    throw new EmbeddingError(`埋め込みの数が一致しません (${out.length} != ${texts.length})`);
  }
  return out;
}

/** 差分判定用のハッシュ。元テキストが変わっていなければ再生成しない */
export async function sha256(text: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
