import { RefreshCw } from 'lucide-react';
import { useFundingData } from '../hooks/useFundingData';
import { formatPercent } from '../lib/format';

function FundingRate({ value }) {
  return <span className={value >= 0 ? 'up' : 'down'}>{formatPercent(value * 100)}</span>;
}

function formatApr(rate8h) {
  return formatPercent(rate8h * 3 * 365 * 100);
}

export default function FundingPage() {
  const { markets, updatedAt, loading, error, refetch } = useFundingData();
  const featuredMarkets = markets.slice(0, 3);

  return (
    <section className="funding-page">
      <div className="funding-heading">
        <div>
          <h1>Funding Differences</h1>
          <p>Compare predicted funding across perpetual exchanges, normalized to 8 hours.</p>
        </div>
        <button className="funding-refresh" type="button" onClick={refetch} disabled={loading}>
          <RefreshCw size={15} className={loading ? 'spin' : ''} /> Refresh
        </button>
      </div>

      {error && (
        <div className="error-banner">
          Couldn't load funding data.
          <button type="button" onClick={refetch}>Retry</button>
        </div>
      )}

      <div className="funding-summary-grid">
        {loading && !featuredMarkets.length ? (
          Array.from({ length: 3 }, (_, index) => <div className="card funding-summary skeleton-card" key={index} />)
        ) : featuredMarkets.map((market) => (
          <article className="card funding-summary" key={market.symbol}>
            <span className="funding-symbol">{market.symbol}-PERP</span>
            <span className="funding-spread">{formatPercent(market.spread8h * 100)}</span>
            <span className="funding-caption">8h funding spread</span>
            <span className="funding-apr">{formatApr(market.spread8h)} APR</span>
            <div className="funding-route">
              <span>Long {market.low.venue}</span>
              <span>Short {market.high.venue}</span>
            </div>
          </article>
        ))}
      </div>

      <div className="card funding-table-card">
        <div className="card-head">
          <div>
            <div className="card-title">Funding opportunities</div>
            <div className="funding-table-note">Positive funding means longs pay shorts.</div>
          </div>
          <div className="card-tab">{loading ? 'Updating…' : `${markets.length} markets`}</div>
        </div>

        {!loading && !markets.length ? (
          <div className="list-empty">Funding data is temporarily unavailable.</div>
        ) : (
          <div className="funding-scroll scroll-area">
            <div className="funding-table-header">
              <span>Market</span><span>Long</span><span>Short</span><span>Spread (8h)</span><span>APR</span>
            </div>
            {markets.slice(0, 30).map((market) => (
              <div className="funding-row" key={market.symbol}>
                <strong>{market.symbol}-PERP</strong>
                <span>{market.low.venue} <FundingRate value={market.low.rate8h} /></span>
                <span>{market.high.venue} <FundingRate value={market.high.rate8h} /></span>
                <strong className="up">{formatPercent(market.spread8h * 100)}</strong>
                <strong className="up">{formatApr(market.spread8h)}</strong>
              </div>
            ))}
          </div>
        )}
      </div>

      <p className="page-note">
        Sources: Lighter and Aster public funding feeds. Funding intervals differ by venue; rates above are converted to an 8-hour equivalent for comparison. APR is a simple annualization of the 8h spread (×3×365), not a guaranteed return. Last update: {updatedAt ? new Date(updatedAt).toLocaleTimeString('en-GB', { timeZone: 'UTC' }) + ' UTC' : '—'}.
      </p>
    </section>
  );
}
