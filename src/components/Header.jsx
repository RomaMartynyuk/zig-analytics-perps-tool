import { Sparkles, Search } from 'lucide-react';

export default function Header() {
  return (
    <header className="app-header">
      <div className="header-brand">
        <Sparkles className="brand-icon" strokeWidth={2.2} />
        <div>
          <h1 className="brand-title">Zig Analytics</h1>
          <p className="brand-sub">Explore information and analytics of main projects in crypto</p>
        </div>
      </div>

      <div className="header-search">
        <input
          className="search-input"
          type="text"
          placeholder="Search"
          aria-label="Search projects"
        />
        <button className="search-btn" aria-label="Search">
          <Search size={18} strokeWidth={2.4} />
        </button>
      </div>
    </header>
  );
}
