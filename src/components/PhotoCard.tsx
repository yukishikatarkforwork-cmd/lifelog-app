import { useRef, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { useReload } from '../lib/useReload';
import { formatBytes, ImageError } from '../lib/image';
import {
  deletePhoto, fetchPhotos, MAX_PHOTOS_PER_DAY, updateCaption, uploadPhoto,
  type PhotoWithUrl,
} from '../lib/photos';
import { reindexInBackground } from '../lib/ai';
import { IconCamera, IconTrash } from './icons';

/**
 * その日の写真。
 * アップロード前にブラウザ側で長辺1600px/WebP に縮小する（`src/lib/image.ts`）。
 * バケットは private なので、表示は都度発行する署名付きURLを使う。
 *
 * readOnly は共有された他人のカレンダーを見るとき用。
 */
export default function PhotoCard({
  date,
  ownerId,
  readOnly = false,
}: {
  date: string;
  ownerId?: string;
  readOnly?: boolean;
}) {
  const { user } = useAuth();
  const [photos, setPhotos] = useState<PhotoWithUrl[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(0);
  const [error, setError] = useState('');
  const [zoom, setZoom] = useState<PhotoWithUrl | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const reload = useReload(async () => {
    setLoading(true);
    try {
      setPhotos(await fetchPhotos(date, ownerId));
      setError('');
    } catch (e) {
      setError(e instanceof Error ? e.message : '写真の読み込みに失敗しました');
    } finally {
      setLoading(false);
    }
  }, [date, ownerId]);

  const onPick = async (files: FileList | null) => {
    if (!files || files.length === 0 || !user) return;
    const room = MAX_PHOTOS_PER_DAY - photos.length;
    if (room <= 0) {
      setError(`1日にアップロードできるのは ${MAX_PHOTOS_PER_DAY} 枚までです。`);
      return;
    }

    const list = [...files].slice(0, room);
    if (list.length < files.length) {
      setError(`残り ${room} 枚までのため、${list.length} 枚だけアップロードします。`);
    } else {
      setError('');
    }

    // 逐次アップロードする。同時に投げるとモバイルでメモリを食いつぶしやすい
    for (let i = 0; i < list.length; i++) {
      setUploading(i + 1);
      try {
        await uploadPhoto(user.id, date, list[i]);
      } catch (e) {
        setError(e instanceof ImageError || e instanceof Error ? e.message : 'アップロードに失敗しました');
        break;
      }
    }
    setUploading(0);
    if (fileRef.current) fileRef.current.value = '';
    await reload();
  };

  const onDelete = async (photo: PhotoWithUrl) => {
    if (!confirm('この写真を削除しますか？')) return;
    try {
      await deletePhoto(photo);
      await reload();
      reindexInBackground([date]);
    } catch (e) {
      setError(e instanceof Error ? e.message : '削除に失敗しました');
    }
  };

  const onCaption = async (photo: PhotoWithUrl, caption: string) => {
    if (caption === (photo.caption ?? '')) return;
    try {
      await updateCaption(photo.id, caption);
      setPhotos((prev) => prev.map((p) => (p.id === photo.id ? { ...p, caption: caption.trim() || null } : p)));
      // キャプションは AI 検索の手がかりになるので索引に反映する
      reindexInBackground([date]);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'キャプションの保存に失敗しました');
    }
  };

  const totalBytes = photos.reduce((s, p) => s + (p.size_bytes ?? 0), 0);

  return (
    <div className="card">
      <div className="section-title">
        <h2><IconCamera /> 写真</h2>
        {photos.length > 0 && (
          <span className="muted" style={{ fontSize: 12 }}>
            {photos.length} 枚 ・ {formatBytes(totalBytes)}
          </span>
        )}
      </div>

      {error && <div className="error-box">{error}</div>}

      {!readOnly && (
        <>
          <input
            ref={fileRef}
            data-testid="photo-input"
            type="file"
            accept="image/*"
            multiple
            style={{ display: 'none' }}
            onChange={(e) => void onPick(e.target.files)}
          />
          <button
            className="btn outline full"
            onClick={() => fileRef.current?.click()}
            disabled={uploading > 0 || photos.length >= MAX_PHOTOS_PER_DAY}
          >
            {uploading > 0 ? `アップロード中… (${uploading})` : '写真を追加'}
          </button>
          <p className="muted" style={{ fontSize: 12, marginTop: 6, marginBottom: 0 }}>
            アップロード前に自動で縮小します（長辺1600px / WebP）。位置情報などの EXIF もこの時点で削除されます。
          </p>
        </>
      )}

      {loading ? (
        <div className="muted" style={{ fontSize: 13, marginTop: 10 }}>読み込み中…</div>
      ) : photos.length === 0 ? (
        !readOnly && <div className="muted" style={{ fontSize: 13, marginTop: 10 }}>まだ写真がありません。</div>
      ) : (
        <div
          style={{
            display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(96px, 1fr))',
            gap: 8, marginTop: 12,
          }}
        >
          {photos.map((p) => (
            <div key={p.id}>
              <button
                type="button"
                onClick={() => setZoom(p)}
                style={{
                  padding: 0, border: 'none', background: 'none', cursor: 'zoom-in',
                  width: '100%', aspectRatio: '1 / 1', borderRadius: 8, overflow: 'hidden',
                }}
                aria-label="拡大して表示"
              >
                <img
                  src={p.url}
                  alt={p.caption ?? '写真'}
                  loading="lazy"
                  style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
                />
              </button>
              {readOnly ? (
                p.caption && <div className="muted" style={{ fontSize: 11, marginTop: 4 }}>{p.caption}</div>
              ) : (
                <div style={{ display: 'flex', gap: 4, marginTop: 4 }}>
                  <input
                    defaultValue={p.caption ?? ''}
                    placeholder="キャプション"
                    onBlur={(e) => void onCaption(p, e.target.value)}
                    style={{
                      flex: 1, minWidth: 0, fontSize: 11, padding: '4px 6px',
                      border: '1px solid var(--border)', borderRadius: 6,
                      background: 'var(--input-bg)', color: 'var(--text)',
                    }}
                  />
                  <button className="btn ghost small" onClick={() => void onDelete(p)} aria-label="写真を削除">
                    <IconTrash />
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {zoom && (
        <div
          onClick={() => setZoom(null)}
          style={{
            position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.85)', zIndex: 100,
            display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16,
            cursor: 'zoom-out',
          }}
        >
          <div style={{ maxWidth: '100%', maxHeight: '100%' }}>
            <img
              src={zoom.url}
              alt={zoom.caption ?? '写真'}
              style={{ maxWidth: '100%', maxHeight: '80vh', display: 'block', margin: '0 auto' }}
            />
            {zoom.caption && (
              <div style={{ color: '#fff', textAlign: 'center', marginTop: 10, fontSize: 13 }}>{zoom.caption}</div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
