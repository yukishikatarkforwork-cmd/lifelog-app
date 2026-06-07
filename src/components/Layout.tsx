import { NavLink, Outlet } from 'react-router-dom';

const NAV = [
  { to: '/', label: '今日', icon: '🍽️', end: true, id: 'today' },
  { to: '/history', label: '履歴', icon: '📅', end: false, id: 'history' },
  { to: '/graph', label: 'グラフ', icon: '📊', end: false, id: 'graph' },
  { to: '/templates', label: 'テンプレ', icon: '⭐', end: false, id: 'templates' },
  { to: '/settings', label: '設定', icon: '⚙️', end: false, id: 'settings' },
];

export default function Layout() {
  return (
    <div className="app-shell">
      <header className="app-header">
        <h1>🥗 Lifelog 食事記録</h1>
      </header>
      <main>
        <Outlet />
      </main>
      <nav className="bottom-nav">
        {NAV.map((n) => (
          <NavLink key={n.to} to={n.to} end={n.end} data-testid={`nav-${n.id}`}
            className={({ isActive }) => (isActive ? 'active' : '')}>
            <span className="icon">{n.icon}</span>
            <span>{n.label}</span>
          </NavLink>
        ))}
      </nav>
    </div>
  );
}
