import { supabase } from './supabase';
import { compressImage } from './image';
import type { Photo } from './types';

export const PHOTO_BUCKET = 'photos';
/** 署名付きURLの有効期限（秒）。表示のたびに発行し直す */
const SIGNED_URL_TTL = 60 * 60;

/** 1日あたりの上限。無制限だと無料枠を一気に食う */
export const MAX_PHOTOS_PER_DAY = 12;

export interface PhotoWithUrl extends Photo {
  url: string;
}

/** 署名付きURLを一括で発行する（バケットは private なので直リンクでは見られない） */
async function withSignedUrls(photos: Photo[]): Promise<PhotoWithUrl[]> {
  if (photos.length === 0) return [];
  const { data, error } = await supabase.storage
    .from(PHOTO_BUCKET)
    .createSignedUrls(photos.map((p) => p.storage_path), SIGNED_URL_TTL);
  if (error) throw new Error(error.message);

  const urlByPath = new Map((data ?? []).map((d) => [d.path, d.signedUrl]));
  return photos
    .map((p) => ({ ...p, url: urlByPath.get(p.storage_path) ?? '' }))
    .filter((p) => p.url !== '');
}

/** その日の写真を取得する（他人の共有分も RLS が許せば見える） */
export async function fetchPhotos(date: string, ownerId?: string): Promise<PhotoWithUrl[]> {
  let query = supabase.from('photos').select('*').eq('date', date).order('created_at');
  if (ownerId) query = query.eq('user_id', ownerId);
  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return withSignedUrls((data as Photo[]) ?? []);
}

/**
 * 写真を1枚アップロードする。
 * パスの先頭を user_id にしているのは、Storage 側のポリシーがフォルダ名で
 * 本人判定・共有判定をするため（{user_id}/{date}/{uuid}.webp）。
 */
export async function uploadPhoto(userId: string, date: string, file: File): Promise<void> {
  const { blob, width, height } = await compressImage(file);
  const path = `${userId}/${date}/${crypto.randomUUID()}.webp`;

  const { error: upErr } = await supabase.storage
    .from(PHOTO_BUCKET)
    .upload(path, blob, { contentType: 'image/webp', upsert: false });
  if (upErr) throw new Error(upErr.message);

  const { error: rowErr } = await supabase.from('photos').insert({
    user_id: userId, date, storage_path: path,
    width, height, size_bytes: blob.size, caption: null,
  });
  if (rowErr) {
    // 行が作れないと参照できない孤児ファイルになるので、実体を消してから失敗させる
    await supabase.storage.from(PHOTO_BUCKET).remove([path]);
    throw new Error(rowErr.message);
  }
}

/** 写真を削除する。実体と行の両方を消す */
export async function deletePhoto(photo: Photo): Promise<void> {
  const { error: rowErr } = await supabase.from('photos').delete().eq('id', photo.id);
  if (rowErr) throw new Error(rowErr.message);
  // 行が消えていれば一覧には出ないので、実体の削除に失敗しても致命的ではない
  await supabase.storage.from(PHOTO_BUCKET).remove([photo.storage_path]);
}

/** 全削除で一度に扱う枚数。id を URL に並べるので大きくしすぎない */
const DELETE_BATCH = 100;

/** 自分の写真をすべて削除する（設定の「すべてのデータを削除」用）。実体と行の両方を消す */
export async function deleteAllPhotos(userId: string): Promise<void> {
  for (;;) {
    // 共有されている他人の写真も RLS 上は見えるので、必ず user_id で絞る
    const { data, error } = await supabase
      .from('photos').select('id,storage_path').eq('user_id', userId).limit(DELETE_BATCH);
    if (error) throw new Error(error.message);
    const batch = (data as Pick<Photo, 'id' | 'storage_path'>[]) ?? [];
    if (batch.length === 0) return;

    const { error: rowErr } = await supabase.from('photos').delete().in('id', batch.map((p) => p.id));
    if (rowErr) throw new Error(rowErr.message);
    await supabase.storage.from(PHOTO_BUCKET).remove(batch.map((p) => p.storage_path));
  }
}

/** キャプションを更新する。AI 検索の手がかりになるので入力を促したい */
export async function updateCaption(id: string, caption: string): Promise<void> {
  const { error } = await supabase
    .from('photos')
    .update({ caption: caption.trim() || null })
    .eq('id', id);
  if (error) throw new Error(error.message);
}
