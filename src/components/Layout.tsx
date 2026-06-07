import { NavLink, Outlet } from 'react-router-dom';

const NAV = [
  { to: '/', label: '今日', icon: '🍽️', end: true },
  { to: '/history', label: '履歴', icon: '📅', end: false },
  { to: '/graph', label: 'グラフ', icon: '📊', end: false },
  { to: '/templates', label: 'テンプレ', icon: '⭐', end: false },
  { to: '/settings', label: '設定', icon: '⚙️', end: false },
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
          <NavLink key={n.to} to={n.to} end={n.end}
            className={({ isActive }) => (isActive ? 'active' : '')}>
            <span className="icon">{n.icon}</span>
            <span>{n.label}</span>
          </NavLink>
        ))}
      </nav>
    </div>
  );
}
