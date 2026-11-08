import { useMemo, useState } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';
import { useReload } from '../lib/useReload';
import { fetchAllRows } from '../lib/fetchAll';
import { addDays, todayStr } from '../lib/date';
import type { Expense, ExpenseCategory, MerchantRule, Subscription } from '../lib/types';
import { DEFAULT_EXPENSE_CATEGORIES } from '../lib/types';
import StatementImport from '../components/money/StatementImport';
import SubscriptionsPanel from '../components/money/SubscriptionsPanel';
import MonthlyReview from '../components/money/MonthlyReview';
import { IconWallet } from '../components/icons';

type Tab = 'review' | 'import' | 'subs';

/** サブスクの年額を検出するため、過去 13 か月ぶんの支出を見る */
const HISTORY_DAYS = 13 * 31;

export interface MoneyData {
  expenses: Expense[];
  subscriptions: Subscription[];
  rules: MerchantRule[];
  categories: string[];
  reload: () => Promise<void>;
}

/**
 * お金の画面。カード明細の取り込み → サブスクの検出・台帳 → 月ごとの振り返り を1か所にまとめる。
 * データは3タブで共有する（取り込んだ直後に振り返りとサブスク検出へ反映されるように）。
 */
export default function MoneyPage() {
  const { user } = useAuth();
  const [tab, setTab] = useState<Tab>('review');
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [subscriptions, setSubscriptions] = useState<Subscription[]>([]);
  const [rules, setRules] = useState<MerchantRule[]>([]);
  const [customCats, setCustomCats] = useState<ExpenseCategory[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const reload = useReload(async () => {
    if (!user) return;
    setError('');
    const start = addDays(todayStr(), -HISTORY_DAYS);
    try {
      const page = (from: number, to: number) =>
        supabase.from('expenses').select('*').eq('user_id', user.id).gte('date', start)
          .order('date', { ascending: false }).order('created_at', { ascending: false }).range(from, to);
      const [exp, subs, rl, cats] = await Promise.all([
        fetchAllRows<Expense>(page),
        supabase.from('subscriptions').select('*').eq('user_id', user.id).order('created_at'),
        supabase.from('merchant_rules').select('*').eq('user_id', user.id).order('created_at'),
        supabase.from('expense_categories').select('*').order('created_at'),
      ]);
      if (subs.error) throw new Error(subs.error.message);
      if (rl.error) throw new Error(rl.error.message);
      setExpenses(exp);
      setSubscriptions((subs.data as Subscription[]) ?? []);
      setRules((rl.data as MerchantRule[]) ?? []);
      setCustomCats((cats.data as ExpenseCategory[]) ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : '記録の取得に失敗しました');
    }
    setLoading(false);
  }, [user?.id]);

  const categories = useMemo(() => {
    const names = [...DEFAULT_EXPENSE_CATEGORIES];
    for (const c of customCats) if (!names.includes(c.name)) names.push(c.name);
    return names;
  }, [customCats]);

  const data: MoneyData = { expenses, subscriptions, rules, categories, reload };

  return (
    <div className="page">
      <h2 style={{ marginTop: 0 }}><IconWallet size={18} /> お金</h2>
      <p className="muted" style={{ fontSize: 13, marginTop: -4 }}>
        カードの利用明細を取り込んで、無駄遣いとサブスクを見直す。登録した支出は「今日」の家計簿にもそのまま入ります。
      </p>

      <div className="tabs">
        <button className={tab === 'review' ? 'active' : ''} onClick={() => setTab('review')} data-testid="money-tab-review">振り返り</button>
        <button className={tab === 'subs' ? 'active' : ''} onClick={() => setTab('subs')} data-testid="money-tab-subs">サブスク</button>
        <button className={tab === 'import' ? 'active' : ''} onClick={() => setTab('import')} data-testid="money-tab-import">取り込み</button>
      </div>

      {error && <div className="error-box">{error}</div>}
      {loading && <div className="empty">読み込み中…</div>}

      {!loading && user && (
        <>
          {tab === 'import' && <StatementImport data={data} userId={user.id} onImported={() => setTab('review')} />}
          {tab === 'subs' && <SubscriptionsPanel data={data} userId={user.id} />}
          {tab === 'review' && <MonthlyReview data={data} onGoImport={() => setTab('import')} onGoSubs={() => setTab('subs')} />}
        </>
      )}
    </div>
  );
}
