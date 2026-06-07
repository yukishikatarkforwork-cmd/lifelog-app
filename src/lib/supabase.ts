import { createClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

/** .env が未設定でもアプリが落ちないようにフラグで判定する */
export const isSupabaseConfigured = Boolean(url && anonKey);

if (!isSupabaseConfigured) {
  // eslint-disable-next-line no-console
  console.warn(
    '[lifelog] VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY が未設定です。.env を作成してください。',
  );
}

// 未設定時もクライアント生成自体は通しておき、UI 側で設定案内を出す
export const supabase = createClient(url ?? 'http://localhost', anonKey ?? 'public-anon-key');
