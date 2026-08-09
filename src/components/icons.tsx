interface P { size?: number }
const s = (size: number): React.SVGProps<SVGSVGElement> => ({
  width: size, height: size, viewBox: '0 0 24 24', fill: 'none',
  stroke: 'currentColor', strokeWidth: 1.75, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const,
  style: { display: 'inline-block', verticalAlign: 'text-bottom', flexShrink: 0 },
});

export const IconHealth = ({ size = 16 }: P) => (
  <svg {...s(size)}><path d="M22 12h-4l-3 9L9 3l-3 9H2"/></svg>
);
export const IconWeather = ({ size = 16 }: P) => (
  <svg {...s(size)}>
    <path d="M18 10h-1.26A8 8 0 109 20h9a5 5 0 000-10z"/>
  </svg>
);
export const IconMeals = ({ size = 16 }: P) => (
  <svg {...s(size)}>
    <path d="M3 2v7c0 1.1.9 2 2 2h4a2 2 0 002-2V2"/><path d="M7 2v20"/>
    <path d="M21 15V2a5 5 0 00-5 5v6c0 1.1.9 2 2 2h3zm0 0v7"/>
  </svg>
);
export const IconWallet = ({ size = 16 }: P) => (
  <svg {...s(size)}>
    <rect x="1" y="4" width="22" height="16" rx="2"/><line x1="1" y1="10" x2="23" y2="10"/>
  </svg>
);
export const IconCalendar = ({ size = 16 }: P) => (
  <svg {...s(size)}>
    <rect x="3" y="4" width="18" height="18" rx="2"/>
    <line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/>
    <line x1="3" y1="10" x2="21" y2="10"/>
  </svg>
);
export const IconTrash = ({ size = 15 }: P) => (
  <svg {...s(size)} style={{ display: 'inline-block', verticalAlign: 'middle', flexShrink: 0 }}>
    <polyline points="3 6 5 6 21 6"/>
    <path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"/>
    <path d="M10 11v6"/><path d="M14 11v6"/>
    <path d="M9 6V4h6v2"/>
  </svg>
);
export const IconSearch = ({ size = 15 }: P) => (
  <svg {...s(size)} style={{ display: 'inline-block', verticalAlign: 'middle', flexShrink: 0 }}>
    <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
  </svg>
);
export const IconDiary = ({ size = 16 }: P) => (
  <svg {...s(size)}>
    <path d="M4 19.5A2.5 2.5 0 016.5 17H20"/>
    <path d="M6.5 2H20v20H6.5A2.5 2.5 0 014 19.5v-15A2.5 2.5 0 016.5 2z"/>
    <line x1="9" y1="7" x2="16" y2="7"/><line x1="9" y1="11" x2="16" y2="11"/>
  </svg>
);
export const IconAsk = ({ size = 16 }: P) => (
  <svg {...s(size)}>
    <path d="M12 3l1.9 4.6L18.5 9.5l-4.6 1.9L12 16l-1.9-4.6L5.5 9.5l4.6-1.9L12 3z"/>
    <path d="M18 15l.9 2.1L21 18l-2.1.9L18 21l-.9-2.1L15 18l2.1-.9L18 15z"/>
  </svg>
);
