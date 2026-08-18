const LABELS = {
  news: 'News',
  analytics: 'Analytics',
  projects: 'Projects',
  community: 'Community',
  calendar: 'Calendar',
  settings: 'Settings',
};

export default function ComingSoon({ section }) {
  return (
    <div className="card coming-soon">
      <div className="card-title">{LABELS[section] || section}</div>
      <p>This section isn't built yet — the sidebar routing is ready, the page just needs content.</p>
    </div>
  );
}
