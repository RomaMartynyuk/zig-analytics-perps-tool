import { useMemo, useState } from 'react';
import { formatUSD } from '../lib/format';
import { useMarketShareMoversData } from '../hooks/useMarketShareMoversData';
import AnalyticsCredit from './AnalyticsCredit';

const METRICS = [
  { id: 'volume', label: 'Volume', valueLabel: '24h volume' },
  { id: 'open_interest', label: 'Open Interest', valueLabel: 'Open interest' },
];
const PERIODS = [
  { id: '7d', label: '7D' },
  { id: '30d', label: '30D' },
  { id: '90d', label: '90D' },
];

function formatDate(value) {
  if (!value) return '—';
  return new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', month: 'short', day: 'numeric', year: 'numeric' })
    .format(new Date(`${String(value).slice(0, 10)}T00:00:00.000Z`));
}

function formatShare(value) {
  return Number.isFinite(value) ? `${value.toFixed(1)}%` : '—';
}

function formatPp(value) {
  if (!Number.isFinite(value)) return '—';
  return `${value > 0 ? '+' : ''}${value.toFixed(1)}pp`;
}

function MoverList({ title, items, direction, metric, startDate, endDate, maxChange }) {
  const safeItems = Array.isArray(items)
    ? items.filter((item) => item?.protocol?.slug && item?.protocol?.name && Number.isFinite(item?.percentagePointChange))
    : [];
  const valueLabel = METRICS.find((option) => option.id === metric)?.valueLabel;

  return (
    <section className={`market-movers-list ${direction}`} aria-label={title}>
      <h3>{title}</h3>
      {safeItems.length ? safeItems.map((item) => (
        <div className="market-mover-row" tabIndex="0" key={item.protocol.slug}>
          <span className="market-mover-rank">#{item.rank}</span>
          <div className="market-mover-main">
            <strong>{item.protocol.name}</strong>
            <span>{formatShare(item.startingShare)} → {formatShare(item.currentShare)}</span>
          </div>
          <div className="market-mover-bar" aria-hidden="true"><i style={{ width: `${Math.max((Math.abs(item.percentagePointChange) / maxChange) * 100, 4)}%` }} /></div>
          <strong className="market-mover-change">{formatPp(item.percentagePointChange)}</strong>
          <span className="market-mover-tooltip" role="tooltip">
            <strong>{item.protocol.name}</strong>
            <span>{formatDate(startDate)}: {formatShare(item.startingShare)} · {valueLabel}: {formatUSD(item.startValue)}</span>
            <span>{formatDate(endDate)}: {formatShare(item.currentShare)} · {valueLabel}: {formatUSD(item.currentValue)}</span>
            <span>Change: {formatPp(item.percentagePointChange)}</span>
            <span>Source: {item.currentDataSource || item.startDataSource || '—'}</span>
          </span>
        </div>
      )) : <p className="market-movers-none">No {direction === 'gainers' ? 'positive' : 'negative'} comparable movers.</p>}
    </section>
  );
}

export default function MarketShareMovers() {
  const [metric, setMetric] = useState('volume');
  const [period, setPeriod] = useState('7d');
  const { data, loading, error, refetch } = useMarketShareMoversData(metric, period);
  const periodLabel = PERIODS.find((option) => option.id === period)?.label;
  const maxChange = useMemo(() => {
    const items = [...(data?.gainers || []), ...(data?.losers || [])];
    return Math.max(...items.map((item) => Math.abs(item?.percentagePointChange || 0)), 1);
  }, [data]);

  return (
    <section className="card market-share-movers" aria-label="Market Share Movers">
      <div className="market-share-head">
        <div>
          <span className="analytics-module-kicker">Market share movers</span>
          <h2>Biggest gainers and losers in tracked market share</h2>
          {!loading && data?.coverage && <p>Coverage: {data.coverage.eligible} / {data.coverage.total} protocols eligible <span>{data.coverage.currentAvailable} reporting at the current snapshot.</span></p>}
        </div>
        <div className="market-share-controls" aria-label="Market Share Movers controls">
          <div className="market-share-control-group">
            {METRICS.map((option) => <button type="button" key={option.id} className={metric === option.id ? 'is-active' : ''} onClick={() => setMetric(option.id)}>{option.label}</button>)}
          </div>
          <div className="market-share-control-group">
            {PERIODS.map((option) => <button type="button" key={option.id} className={period === option.id ? 'is-active' : ''} onClick={() => setPeriod(option.id)}>{option.label}</button>)}
          </div>
        </div>
      </div>

      {loading && <div className="market-movers-loading" aria-label="Loading market share movers"><i /><i /><i /><i /></div>}

      {!loading && error && (
        <div className="market-share-empty market-movers-empty">
          <strong>Market share mover data is temporarily unavailable.</strong>
          <button type="button" onClick={refetch}>Retry</button>
        </div>
      )}

      {!loading && !error && !data?.sufficientHistory && (
        <div className="market-share-empty market-movers-empty">
          <strong>{periodLabel} movers are still being collected</strong>
          <span>Zig has {data?.availableDays || 0} of {data?.requiredDays || 0} consecutive daily snapshots available.</span>
          <span>This view unlocks automatically as history accumulates.</span>
        </div>
      )}

      {!loading && !error && data?.sufficientHistory && (
        <>
          <div className="market-movers-meta">{formatDate(data.startDate)} → {formatDate(data.endDate)}{data.coverage?.comparisonUnavailable > 0 ? ` · Historical comparison unavailable for ${data.coverage.comparisonUnavailable} protocols` : ''}</div>
          <div className="market-movers-grid">
            <MoverList title="Gainers" items={data.gainers} direction="gainers" metric={metric} startDate={data.startDate} endDate={data.endDate} maxChange={maxChange} />
            <MoverList title="Losers" items={data.losers} direction="losers" metric={metric} startDate={data.startDate} endDate={data.endDate} maxChange={maxChange} />
          </div>
        </>
      )}
      <AnalyticsCredit />
    </section>
  );
}
