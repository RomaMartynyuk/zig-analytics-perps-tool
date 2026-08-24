import { formatUSD } from '../lib/format';

export default function ChartCard({ sources, loading, error }) {
  const venues = sources.slice(0, 8);
  const maxVolume = Math.max(...venues.map((venue) => venue.value), 0);
  const scaleMax = maxVolume || 1;

  return (
    <div className="card chart-card">
      <div className="card-head">
        <div className="card-title">Perps Volume Graph</div>
        <div className="card-tab">Live · 24h</div>
      </div>

      {loading ? (
        <div className="chart-placeholder"><span>Loading live volume…</span></div>
      ) : error || !venues.length ? (
        <div className="chart-placeholder"><span>Live volume data is temporarily unavailable.</span></div>
      ) : (
        <>
          <div className="volume-chart" aria-label="Top exchanges by 24-hour perpetual volume">
            <div className="volume-chart-scale" aria-hidden="true">
              <span>{formatUSD(scaleMax)}</span>
              <span>{formatUSD(scaleMax / 2)}</span>
              <span>$0</span>
            </div>
            <div className="volume-chart-bars">
              {venues.map((venue, index) => {
                const height = Math.max(3, (venue.value / scaleMax) * 100);
                return (
                  <div className="volume-bar-group" key={venue.name} title={`${venue.name}: ${formatUSD(venue.value)}`}>
                    <div className="volume-bar-track">
                      <div className={`volume-bar-fill volume-bar-${index % 5}`} style={{ height: `${height}%` }} />
                    </div>
                    <span className="volume-bar-label">{venue.name}</span>
                  </div>
                );
              })}
            </div>
          </div>
          <p className="chart-note">Top {venues.length} exchanges by live 24h perpetual volume. Hover a bar for its exact value.</p>
        </>
      )}
    </div>
  );
}
