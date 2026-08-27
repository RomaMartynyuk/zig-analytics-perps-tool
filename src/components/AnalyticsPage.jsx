import MarketShareMap from './MarketShareMap';
import MarketShareMovers from './MarketShareMovers';
import VolumeOiAnalysis from './VolumeOiAnalysis';

export default function AnalyticsPage() {
  return (
    <section className="analytics-page" aria-label="Analytics">
      <div className="analytics-heading">
        <div>
          <span className="analytics-kicker">Research workspace · 03</span>
          <h1>Analytics canvas</h1>
          <p>Signals, comparisons and farming research will live here.</p>
        </div>
      </div>

      <div className="analytics-skeleton-grid">
        <MarketShareMap />
        <VolumeOiAnalysis />
        <div className="card analytics-skeleton analytics-skeleton-small" aria-hidden="true" />
        <MarketShareMovers />
        <div className="card analytics-skeleton analytics-skeleton-small" aria-hidden="true" />
      </div>
    </section>
  );
}
