import { NavLink, Outlet } from 'react-router-dom';

const IconToday = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
    <rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/>
    <rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>
  </svg>
);
const IconHistory = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="9"/><polyline points="12 7 12 12 15.5 15.5"/>
  </svg>
);
const IconGraph = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
    <line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/>
    <line x1="6" y1="20" x2="6" y2="14"/><line x1="2" y1="20" x2="22" y2="20"/>
  </svg>
);
const IconTripNav = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
    <rect x="2" y="7" width="20" height="14" rx="2"/>
    <path d="M8 7V5a2 2 0 012-2h4a2 2 0 012 2v2"/>
    <line x1="2" y1="13" x2="22" y2="13"/>
  </svg>
);
const IconAskNav = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
    <path d="M12 3l1.9 4.6L18.5 9.5l-4.6 1.9L12 16l-1.9-4.6L5.5 9.5l4.6-1.9L12 3z"/>
    <path d="M18 15l.9 2.1L21 18l-2.1.9L18 21l-.9-2.1L15 18l2.1-.9L18 15z"/>
  </svg>
);
const IconSettings = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
    <line x1="4" y1="6" x2="20" y2="6"/>
    <line x1="4" y1="12" x2="20" y2="12"/>
    <line x1="4" y1="18" x2="20" y2="18"/>
    <circle cx="8" cy="6" r="2.25" fill="currentColor" stroke="none"/>
    <circle cx="16" cy="12" r="2.25" fill="currentColor" stroke="none"/>
    <circle cx="10" cy="18" r="2.25" fill="currentColor" stroke="none"/>
  </svg>
);

const NAV = [
  { to: '/', label: '今日', Icon: IconToday, end: true, id: 'today' },
  { to: '/history', label: '履歴', Icon: IconHistory, end: false, id: 'history' },
  { to: '/graph', label: '分析', Icon: IconGraph, end: false, id: 'graph' },
  { to: '/ask', label: 'AI', Icon: IconAskNav, end: false, id: 'ask' },
  { to: '/trips', label: '旅', Icon: IconTripNav, end: false, id: 'trips' },
  { to: '/settings', label: '設定', Icon: IconSettings, end: false, id: 'settings' },
];

export default function Layout() {
  return (
    <div className="app-shell">
      <header className="app-header">
        <h1>Lifelog</h1>
        <nav className="desktop-nav">
          {NAV.map((n) => (
            <NavLink key={n.to} to={n.to} end={n.end}
              className={({ isActive }) => (isActive ? 'active' : '')}>
              <span className="icon"><n.Icon /></span>
              <span>{n.label}</span>
            </NavLink>
          ))}
        </nav>
      </header>
      <main>
        <Outlet />
      </main>
      <nav className="bottom-nav">
        {NAV.map((n) => (
          <NavLink key={n.to} to={n.to} end={n.end} data-testid={`nav-${n.id}`}
            className={({ isActive }) => (isActive ? 'active' : '')}>
            <span className="icon"><n.Icon /></span>
            <span>{n.label}</span>
          </NavLink>
        ))}
      </nav>
    </div>
  );
}
