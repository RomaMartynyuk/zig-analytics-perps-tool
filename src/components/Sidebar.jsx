import { motion } from 'framer-motion';
import {
  LayoutGrid,
  Newspaper,
  BarChart3,
  Building2,
  Percent,
  Calendar,
  Settings,
} from 'lucide-react';

const NAV_ITEMS = [
  { id: 'dashboard', label: 'Dashboard', icon: LayoutGrid },
  { id: 'news', label: 'News', icon: Newspaper },
  { id: 'analytics', label: 'Analytics', icon: BarChart3 },
  { id: 'projects', label: 'Projects', icon: Building2 },
  { id: 'funding', label: 'Funding', icon: Percent },
  { id: 'calendar', label: 'Calendar', icon: Calendar },
];

export default function Sidebar({ active, onChange }) {
  return (
    <aside className="sidebar">
      <nav className="sb-nav">
        {NAV_ITEMS.map(({ id, label, icon: Icon }) => {
          const isActive = active === id;
          return (
            <button
              key={id}
              className="sb-item"
              onClick={() => onChange(id)}
              aria-label={label}
              aria-current={isActive}
            >
              {isActive && (
                <motion.div
                  layoutId="sb-active-indicator"
                  className="sb-indicator"
                  transition={{ type: 'spring', stiffness: 420, damping: 34 }}
                />
              )}
              <Icon size={18} strokeWidth={2.2} className="sb-icon" />
            </button>
          );
        })}
      </nav>

      <div className="sb-spacer" />

      <button
        className="sb-item"
        onClick={() => onChange('settings')}
        aria-label="Settings"
        aria-current={active === 'settings'}
      >
        {active === 'settings' && (
          <motion.div
            layoutId="sb-active-indicator"
            className="sb-indicator"
            transition={{ type: 'spring', stiffness: 420, damping: 34 }}
          />
        )}
        <Settings size={18} strokeWidth={2.2} className="sb-icon" />
      </button>

      <a
        className="sb-avatar"
        href="https://x.com/herzig_crypto"
        target="_blank"
        rel="noopener noreferrer"
        title="@herzig_crypto on X"
        aria-label="View developer on X (Twitter)"
      >
        <img src="/avatar.jpg" alt="" />
      </a>
    </aside>
  );
}
