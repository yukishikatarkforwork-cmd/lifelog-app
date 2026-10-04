/**
 * アップロード前に画像を縮小・再エンコードする。
 *
 * 無料枠は 1GB。スマホの写真は1枚 3〜5MB あるので、そのまま上げると 250 枚で埋まる。
 * 長辺 1600px / WebP に落とすと 1枚 200KB 前後になり、5000 枚入る。
 *
 * 副作用として EXIF が落ちる。位置情報が写真に埋まったままクラウドに上がるのを
 * 防げるので、プライバシー面でも都合がよい。
 * 一方で回転情報も落ちるため、デコード時に imageOrientation で焼き込んでおく。
 */

/** 長辺の最大ピクセル数 */
export const MAX_EDGE = 1600;
/** WebP の品質 */
export const QUALITY = 0.8;
/** 受け付ける元ファイルの上限（これを超えるものはブラウザが落ちやすい） */
export const MAX_INPUT_BYTES = 30 * 1024 * 1024;

export interface CompressedImage {
  blob: Blob;
  width: number;
  height: number;
}

export class ImageError extends Error {}

export interface CompressOptions {
  /** 長辺の最大ピクセル数（既定 MAX_EDGE） */
  maxEdge?: number;
  /** 品質 0〜1（既定 QUALITY） */
  quality?: number;
  /** 出力形式（既定 image/webp） */
  type?: 'image/webp' | 'image/jpeg';
}

export async function compressImage(file: File, opts: CompressOptions = {}): Promise<CompressedImage> {
  const maxEdge = opts.maxEdge ?? MAX_EDGE;
  const quality = opts.quality ?? QUALITY;
  const type = opts.type ?? 'image/webp';
  if (!file.type.startsWith('image/')) {
    throw new ImageError('画像ファイルを選んでください。');
  }
  if (file.size > MAX_INPUT_BYTES) {
    throw new ImageError('ファイルが大きすぎます（30MB まで）。');
  }

  let bitmap: ImageBitmap;
  try {
    // from-image で EXIF の回転を反映してからピクセルに焼き込む
    bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch {
    // HEIC など、ブラウザがデコードできない形式
    throw new ImageError('この形式の画像は読み込めませんでした。JPEG または PNG でお試しください。');
  }

  try {
    const scale = Math.min(1, maxEdge / Math.max(bitmap.width, bitmap.height));
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new ImageError('画像の変換に失敗しました。');
    ctx.drawImage(bitmap, 0, 0, width, height);

    const blob = await new Promise<Blob | null>((resolve) => {
      canvas.toBlob(resolve, type, quality);
    });
    if (!blob) throw new ImageError('画像の変換に失敗しました。');

    return { blob, width, height };
  } finally {
    bitmap.close();
  }
}

/** 表示用のサイズ文字列 */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
