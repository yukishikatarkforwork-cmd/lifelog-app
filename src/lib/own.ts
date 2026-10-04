import { supabase } from './supabase';

/**
 * ログイン中ユーザーの id を返す（セッションはローカルに保持されているので通信しない）。
 *
 * カレンダー共有の RLS は「共有相手の行」も SELECT できるようにしている。
 * そのため自分の記録を引くクエリは user_id で絞らないと、受け入れた共有の記録が
 * 自分の画面・集計・AI の文脈に混ざる。コンポーネント外（lib）からはこれで絞る。
 */
export async function currentUserId(): Promise<string> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error('ログインが必要です。');
  return session.user.id;
}
