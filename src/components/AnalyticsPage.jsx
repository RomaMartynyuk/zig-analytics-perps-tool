import MarketShareMap from './MarketShareMap';
import MarketShareMovers from './MarketShareMovers';
import VolumeOiAnalysis from './VolumeOiAnalysis';
import VolumeOiShareAnalysis from './VolumeOiShareAnalysis';
import GrowthMatrix from './GrowthMatrix';
import ZigSignals from './ZigSignals';

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
        <ZigSignals />
        <MarketShareMap />
        <VolumeOiAnalysis />
        <VolumeOiShareAnalysis />
        <MarketShareMovers />
        <GrowthMatrix />
      </div>
    </section>
  );
}
