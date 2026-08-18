import { formatStatUSD, formatPercent } from '../lib/format';

export default function StatCard({ label, value, change }) {
  return (
    <div className="card stat-card">
      <div className="stat-label">{label}</div>
      <div className="stat-row">
        <span className="stat-value">{formatStatUSD(value)}</span>
        <span className={`stat-change ${change >= 0 ? 'up' : 'down'}`}>
          {formatPercent(change)}
        </span>
      </div>
    </div>
  );
}
