import { supabase } from './supabase';
import type { Share, ShareScope } from './types';

/**
 * カレンダー共有。
 * 共有は必ず「カテゴリ」「期間」で絞り、読み取り専用にする。
 * 実際の閲覧可否は DB 側の can_view() と各テーブルの SELECT ポリシーが決めるので、
 * ここでの制御は UI の見せ方であって、セキュリティ境界ではない。
 */

export async function createShare(params: {
  ownerId: string;
  ownerEmail: string;
  inviteeEmail: string;
  scopes: ShareScope[];
  startDate: string | null;
  endDate: string | null;
}): Promise<void> {
  const invitee = params.inviteeEmail.trim().toLowerCase();
  if (invitee === '') throw new Error('共有相手のメールアドレスを入力してください。');
  if (invitee === params.ownerEmail.trim().toLowerCase()) {
    throw new Error('自分自身には共有できません。');
  }
  if (params.scopes.length === 0) {
    throw new Error('共有する項目を1つ以上選んでください。');
  }
  if (params.startDate && params.endDate && params.startDate > params.endDate) {
    throw new Error('開始日が終了日より後になっています。');
  }

  const { error } = await supabase.from('shares').insert({
    owner_id: params.ownerId,
    owner_email: params.ownerEmail,
    invitee_email: invitee,
    scopes: params.scopes,
    start_date: params.startDate,
    end_date: params.endDate,
    status: 'pending',
  });
  if (error) {
    if (error.code === '23505') throw new Error('この相手にはすでに共有を作成しています。');
    throw new Error(error.message);
  }
}

/** 自分が共有しているもの */
export async function listOutgoing(ownerId: string): Promise<Share[]> {
  const { data, error } = await supabase
    .from('shares').select('*')
    .eq('owner_id', ownerId)
    .order('created_at', { ascending: false });
  if (error) throw new Error(error.message);
  return (data as Share[]) ?? [];
}

/**
 * 自分に共有されているもの（招待中と承諾済みの両方）。
 * .or() に値を文字列で埋め込むとフィルタ構文が壊れうる（メールに , や ) を含む場合）ので、
 * 2本のクエリに分けて結合する。
 */
export async function listIncoming(userId: string, email: string): Promise<Share[]> {
  const [byViewer, byEmail] = await Promise.all([
    supabase.from('shares').select('*').eq('viewer_id', userId),
    supabase.from('shares').select('*').eq('invitee_email', email.toLowerCase()),
  ]);
  const err = byViewer.error || byEmail.error;
  if (err) throw new Error(err.message);

  const merged = new Map<string, Share>();
  for (const s of [...((byViewer.data as Share[]) ?? []), ...((byEmail.data as Share[]) ?? [])]) {
    merged.set(s.id, s);
  }
  return [...merged.values()]
    .filter((s) => s.owner_id !== userId && s.status !== 'revoked')
    .sort((a, b) => b.created_at.localeCompare(a.created_at));
}

/** 招待を承諾する。scopes を書き換えられないよう、承諾は RPC 経由に限定している */
export async function acceptShare(shareId: string): Promise<void> {
  const { error } = await supabase.rpc('accept_share', { p_share_id: shareId });
  if (error) throw new Error(error.message);
}

/** 共有を取り消す（共有元のみ）。行を消すので相手からは即座に見えなくなる */
export async function revokeShare(shareId: string): Promise<void> {
  const { error } = await supabase.from('shares').delete().eq('id', shareId);
  if (error) throw new Error(error.message);
}

/** 共有内容（カテゴリ・期間）を更新する（共有元のみ） */
export async function updateShareScopes(shareId: string, scopes: ShareScope[]): Promise<void> {
  if (scopes.length === 0) throw new Error('共有する項目を1つ以上選んでください。');
  const { error } = await supabase.from('shares').update({ scopes }).eq('id', shareId);
  if (error) throw new Error(error.message);
}

/** 閲覧中の共有を1件取る（共有カレンダー画面で、許可されたカテゴリを知るため） */
export async function getAcceptedShare(ownerId: string, viewerId: string): Promise<Share | null> {
  const { data, error } = await supabase
    .from('shares').select('*')
    .eq('owner_id', ownerId).eq('viewer_id', viewerId).eq('status', 'accepted')
    .maybeSingle();
  if (error) throw new Error(error.message);
  return (data as Share | null) ?? null;
}
