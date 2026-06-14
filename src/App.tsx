import { lazy, Suspense } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { useAuth } from './context/AuthContext';
import { isSupabaseConfigured } from './lib/supabase';
import Layout from './components/Layout';
import SetupNotice from './components/SetupNotice';

// ルートごとにコード分割し、初期表示に不要な画面（特に recharts を含む分析画面）を遅延ロードする
const LoginPage = lazy(() => import('./pages/LoginPage'));
const TodayPage = lazy(() => import('./pages/TodayPage'));
const HistoryPage = lazy(() => import('./pages/HistoryPage'));
const GraphPage = lazy(() => import('./pages/GraphPage'));
const TemplatesPage = lazy(() => import('./pages/TemplatesPage'));
const SettingsPage = lazy(() => import('./pages/SettingsPage'));
const ExportPage = lazy(() => import('./pages/ExportPage'));

const Loading = () => <div className="spinner-wrap">読み込み中…</div>;

export default function App() {
  const { session, loading } = useAuth();

  if (!isSupabaseConfigured) {
    return <SetupNotice />;
  }

  if (loading) {
    return <Loading />;
  }

  if (!session) {
    return (
      <Suspense fallback={<Loading />}>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route path="*" element={<Navigate to="/login" replace />} />
        </Routes>
      </Suspense>
    );
  }

  return (
    <Suspense fallback={<Loading />}>
      <Routes>
        <Route element={<Layout />}>
          <Route path="/" element={<TodayPage />} />
          <Route path="/day/:date" element={<TodayPage />} />
          <Route path="/history" element={<HistoryPage />} />
          <Route path="/graph" element={<GraphPage />} />
          <Route path="/templates" element={<TemplatesPage />} />
          <Route path="/export" element={<ExportPage />} />
          <Route path="/settings" element={<SettingsPage />} />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Suspense>
  );
}
