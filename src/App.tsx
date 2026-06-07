import { Navigate, Route, Routes } from 'react-router-dom';
import { useAuth } from './context/AuthContext';
import { isSupabaseConfigured } from './lib/supabase';
import Layout from './components/Layout';
import LoginPage from './pages/LoginPage';
import TodayPage from './pages/TodayPage';
import HistoryPage from './pages/HistoryPage';
import GraphPage from './pages/GraphPage';
import TemplatesPage from './pages/TemplatesPage';
import SettingsPage from './pages/SettingsPage';
import SetupNotice from './components/SetupNotice';

export default function App() {
  const { session, loading } = useAuth();

  if (!isSupabaseConfigured) {
    return <SetupNotice />;
  }

  if (loading) {
    return <div className="spinner-wrap">読み込み中…</div>;
  }

  if (!session) {
    return (
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="*" element={<Navigate to="/login" replace />} />
      </Routes>
    );
  }

  return (
    <Routes>
      <Route element={<Layout />}>
        <Route path="/" element={<TodayPage />} />
        <Route path="/day/:date" element={<TodayPage />} />
        <Route path="/history" element={<HistoryPage />} />
        <Route path="/graph" element={<GraphPage />} />
        <Route path="/templates" element={<TemplatesPage />} />
        <Route path="/settings" element={<SettingsPage />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
