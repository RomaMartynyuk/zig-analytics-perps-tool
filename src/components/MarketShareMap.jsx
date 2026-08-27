import { useMemo, useState } from 'react';
import { formatUSD } from '../lib/format';
import { selectTopMarketShareSeries } from '../lib/marketShare';
import { useMarketShareData } from '../hooks/useMarketShareData';

const METRICS = [
  { id: 'volume', label: 'Volume', valueLabel: '24h volume' },
  { id: 'open_interest', label: 'Open Interest', valueLabel: 'Open interest' },
];
const PERIODS = [
  { id: 'current', label: 'Current' },
  { id: '7d', label: '7D' },
  { id: '30d', label: '30D' },
  { id: '90d', label: '90D' },
];

function formatDate(value) {
  if (!value) return '—';
  return new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', month: 'short', day: 'numeric', year: 'numeric' })
    .format(new Date(`${String(value).slice(0, 10)}T00:00:00.000Z`));
}

function formatCapturedAt(value) {
  if (!value) return null;
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: 'UTC', hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(new Date(value));
}

function formatShare(value) {
  return value == null ? '—' : `${value.toFixed(1)}%`;
}

function HistoricalShareChart({ values, metric }) {
  const { dates, series } = useMemo(() => selectTopMarketShareSeries(values), [values]);

  if (!dates.length) return null;
  const width = 640;
  const height = 210;
  const padding = { top: 14, right: 12, bottom: 30, left: 38 };
  const plotWidth = width - padding.left - padding.right;
  const plotHeight = height - padding.top - padding.bottom;
  const x = (index) => padding.left + (dates.length === 1 ? plotWidth / 2 : (index / (dates.length - 1)) * plotWidth);
  const y = (share) => padding.top + (1 - Math.min(Math.max(share, 0), 100) / 100) * plotHeight;

  return (
    <div className="market-share-history" aria-label={`${metric} share history`}>
      <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Tracked market share history">
        {[0, 25, 50, 75, 100].map((tick) => (
          <g key={tick}>
            <line x1={padding.left} x2={width - padding.right} y1={y(tick)} y2={y(tick)} className="market-share-gridline" />
            <text x="0" y={y(tick) + 3} className="market-share-axis">{tick}%</text>
          </g>
        ))}
        {series.map((item) => {
          const path = item.points.map((point) => {
            const index = dates.indexOf(point.date);
            return `${index === 0 ? 'M' : 'L'} ${x(index)} ${y(point.share)}`;
          }).join(' ');
          return <path key={item.slug} d={path} fill="none" stroke={item.color} strokeWidth="2.5" strokeLinecap="round" />;
        })}
        {series.flatMap((item) => item.points.map((point) => {
          const index = dates.indexOf(point.date);
          return (
            <circle key={`${item.slug}-${point.date}`} cx={x(index)} cy={y(point.share)} r="3.5" fill={item.color}>
              <title>{`${formatDate(point.date)}\n${point.protocol.name}\nTracked share: ${formatShare(point.share)}\n${METRICS.find((option) => option.id === metric)?.valueLabel}: ${formatUSD(point.value)}\nSource: ${point.dataSource || '—'}`}</title>
            </circle>
          );
        }))}
        {dates.map((date, index) => (
          <text key={date} x={x(index)} y={height - 8} textAnchor="middle" className="market-share-axis">
            {new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', month: 'short', day: 'numeric' }).format(new Date(`${date}T00:00:00.000Z`))}
          </text>
        ))}
      </svg>
      <div className="market-share-legend">
        {series.map((item) => <span key={item.slug}><i style={{ backgroundColor: item.color }} />{item.points[0]?.protocol.name}</span>)}
      </div>
    </div>
  );
}

function CurrentShareBars({ values, metric }) {
  const valueLabel = METRICS.find((option) => option.id === metric)?.valueLabel;
  const safeValues = Array.isArray(values)
    ? values.filter((item) => item?.protocol?.slug && item?.protocol?.name && Number.isFinite(item?.value) && Number.isFinite(item?.share))
    : [];
  return (
    <div className="market-share-bars">
      {safeValues.map((item) => (
        <div className="market-share-row" key={item.protocol.slug}>
          <span className="market-share-rank">#{item.rank}</span>
          <span className="market-share-name">{item.protocol.name}</span>
          <div className={`market-share-bar-track ${item.rank <= 3 ? 'tooltip-below' : ''}`}>
            <div className="market-share-bar-fill" style={{ width: `${item.share}%` }} />
            <span className="market-share-tooltip" role="tooltip">
              <strong>{item.protocol.name}</strong>
              <span>{valueLabel}: {formatUSD(item.value)}</span>
              <span>Tracked share: {formatShare(item.share)}</span>
              <span>Source: {item.dataSource || '—'}</span>
            </span>
          </div>
          <strong className="market-share-percent">{formatShare(item.share)}</strong>
        </div>
      ))}
    </div>
  );
}

export default function MarketShareMap() {
  const [metric, setMetric] = useState('volume');
  const [period, setPeriod] = useState('current');
  const { data, loading, error, refetch } = useMarketShareData(metric, period);
  const periodLabel = PERIODS.find((option) => option.id === period)?.label;
  const coverage = data?.coverage;
  const capturedAt = formatCapturedAt(data?.capturedAt);
  const currentValues = Array.isArray(data?.values) ? data.values : [];

  return (
    <section className="card market-share-map" aria-label="Market Share Map">
      <div className="market-share-head">
        <div>
          <span className="analytics-module-kicker">Market share map</span>
          <h2>Tracked Perp DEX market distribution</h2>
          {!loading && coverage && <p>Coverage: {coverage.available} / {coverage.total} protocols <span>Share uses only available protocol data.</span></p>}
        </div>
        <div className="market-share-controls" aria-label="Market Share Map controls">
          <div className="market-share-control-group">
            {METRICS.map((option) => <button type="button" key={option.id} className={metric === option.id ? 'is-active' : ''} onClick={() => setMetric(option.id)}>{option.label}</button>)}
          </div>
          <div className="market-share-control-group">
            {PERIODS.map((option) => <button type="button" key={option.id} className={period === option.id ? 'is-active' : ''} onClick={() => setPeriod(option.id)}>{option.label}</button>)}
          </div>
        </div>
      </div>

      {loading && (
        <div className="market-share-loading" aria-label="Loading market share data">
          <i /><i /><i /><i /><i />
        </div>
      )}

      {!loading && error && (
        <div className="market-share-empty">
          <strong>Market share data is temporarily unavailable.</strong>
          <button type="button" onClick={refetch}>Retry</button>
        </div>
      )}

      {!loading && !error && period === 'current' && (!data?.snapshotDate || !currentValues.length) && (
        <div className="market-share-empty"><strong>No canonical daily snapshot is available yet.</strong><span>It will appear after the first successful 12:00 UTC collection.</span></div>
      )}

      {!loading && !error && period === 'current' && data?.snapshotDate && currentValues.length > 0 && (
        <div className="market-share-current">
          <div className="market-share-meta">Snapshot: {formatDate(data.snapshotDate)}{capturedAt ? ` · Captured at ${capturedAt} UTC` : ''}</div>
          <CurrentShareBars values={currentValues} metric={metric} />
          {coverage?.missing > 0 && (
            <details className="market-share-missing">
              <summary>Data still being collected for {coverage.missing} tracked protocols</summary>
              <span>{(Array.isArray(data.missingProtocols) ? data.missingProtocols : []).map((protocol) => protocol?.name).filter(Boolean).join(', ')}</span>
            </details>
          )}
        </div>
      )}

      {!loading && !error && period !== 'current' && !data?.sufficientHistory && (
        <div className="market-share-empty market-share-history-empty">
          <strong>{periodLabel} history is still being collected</strong>
          <span>Zig has {data?.availableDays || 0} of {data?.requiredDays || 0} consecutive daily snapshots available.</span>
          <span>This view unlocks automatically as daily snapshots accumulate.</span>
        </div>
      )}

      {!loading && !error && period !== 'current' && data?.sufficientHistory && <HistoricalShareChart values={data.values} metric={metric} />}
    </section>
  );
}
