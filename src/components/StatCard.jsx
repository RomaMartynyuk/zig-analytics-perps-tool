import { formatStatUSD, formatPercent } from '../lib/format';

export default function StatCard({ label, value, change, loading, unavailable }) {
  return (
    <div className="card stat-card">
      <div className="stat-label">{label}</div>

      {loading ? (
        <div className="stat-row">
          <span className="skeleton-line" style={{ width: 90, height: 22 }} />
        </div>
      ) : unavailable ? (
        <div className="stat-row">
          <span className="stat-value stat-nan">NaN</span>
        </div>
      ) : (
        <div className="stat-row">
          <span className="stat-value">{formatStatUSD(value)}</span>
          {change != null && (
            <span className={`stat-change ${change >= 0 ? 'up' : 'down'}`}>
              {formatPercent(change)}
            </span>
          )}
        </div>
      )}
    </div>
  );
}
