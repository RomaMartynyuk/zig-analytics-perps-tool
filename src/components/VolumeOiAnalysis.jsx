import { useMemo, useState } from 'react';
import { formatUSD } from '../lib/format';
import { getProtocolColor } from '../lib/marketShare';
import { useVolumeOiAnalysisData } from '../hooks/useVolumeOiAnalysisData';

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

function formatRatio(value) {
  return Number.isFinite(value) ? `${value.toFixed(2)}x` : '—';
}

function formatShare(value) {
  return Number.isFinite(value) ? `${value.toFixed(1)}%` : '—';
}

function safePoints(protocols) {
  return (Array.isArray(protocols) ? protocols : []).filter((protocol) => (
    protocol?.slug
    && protocol?.name
    && Number.isFinite(protocol?.volume24h)
    && Number.isFinite(protocol?.openInterest)
    && protocol.volume24h > 0
    && protocol.openInterest > 0
  ));
}

function ScatterChart({ protocols, scale, selectedSlug, onSelect, snapshotDate }) {
  const points = useMemo(() => safePoints(protocols), [protocols]);
  const highlighted = useMemo(() => new Set(points.slice().sort((a, b) => b.volume24h - a.volume24h).slice(0, 3).map((point) => point.slug)), [points]);
  if (points.length < 2) return null;

  const width = 550;
  const height = 218;
  const padding = { top: 14, right: 18, bottom: 35, left: 48 };
  const plotWidth = width - padding.left - padding.right;
  const plotHeight = height - padding.top - padding.bottom;
  const transform = (value) => (scale === 'log' ? Math.log10(value) : value);
  const xValues = points.map((point) => transform(point.openInterest));
  const yValues = points.map((point) => transform(point.volume24h));
  const withPadding = (values) => {
    const low = Math.min(...values);
    const high = Math.max(...values);
    const range = high - low || Math.max(Math.abs(high) * 0.2, 1);
    return [low - range * 0.08, high + range * 0.08];
  };
  const [xMin, xMax] = withPadding(xValues);
  const [yMin, yMax] = withPadding(yValues);
  const x = (value) => padding.left + ((transform(value) - xMin) / (xMax - xMin)) * plotWidth;
  const y = (value) => padding.top + (1 - ((transform(value) - yMin) / (yMax - yMin))) * plotHeight;
  const lowerReference = Math.max(Math.min(...points.map((point) => point.openInterest)), Math.min(...points.map((point) => point.volume24h)));
  const upperReference = Math.min(Math.max(...points.map((point) => point.openInterest)), Math.max(...points.map((point) => point.volume24h)));
  const selected = points.find((point) => point.slug === selectedSlug);

  return (
    <>
      <div className="volume-oi-chart" aria-label="Volume versus open interest scatter chart">
        <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`24 hour volume versus open interest on ${formatDate(snapshotDate)}`}>
          {[0.25, 0.5, 0.75].map((fraction) => {
            const lineY = padding.top + plotHeight * fraction;
            return <line key={fraction} x1={padding.left} x2={width - padding.right} y1={lineY} y2={lineY} className="volume-oi-gridline" />;
          })}
          <line x1={padding.left} x2={width - padding.right} y1={padding.top + plotHeight} y2={padding.top + plotHeight} className="volume-oi-axis-line" />
          <line x1={padding.left} x2={padding.left} y1={padding.top} y2={padding.top + plotHeight} className="volume-oi-axis-line" />
          {lowerReference < upperReference && <line x1={x(lowerReference)} y1={y(lowerReference)} x2={x(upperReference)} y2={y(upperReference)} className="volume-oi-reference" />}
          {points.map((point) => {
            const selectedPoint = point.slug === selectedSlug;
            return (
              <g key={point.slug} className="volume-oi-point" onClick={() => onSelect(point.slug)} onKeyDown={(event) => event.key === 'Enter' && onSelect(point.slug)} tabIndex="0" role="button" aria-label={`Select ${point.name}`}>
                <circle cx={x(point.openInterest)} cy={y(point.volume24h)} r={selectedPoint ? 6.5 : 5} fill={getProtocolColor(point.slug)} className={selectedPoint ? 'is-selected' : ''} />
                <title>{`${point.name}\n24h Volume: ${formatUSD(point.volume24h)}\nOpen Interest: ${formatUSD(point.openInterest)}\nVolume / OI: ${formatRatio(point.volumeOiRatio)}\nVolume Share: ${formatShare(point.volumeShare)}\nOI Share: ${formatShare(point.openInterestShare)}\nSnapshot: ${formatDate(snapshotDate)}\nSource: ${point.dataSource || '—'}`}</title>
                {highlighted.has(point.slug) && <text x={x(point.openInterest) + 7} y={y(point.volume24h) - 7} className="volume-oi-label">{point.name}</text>}
              </g>
            );
          })}
          <text x={padding.left + plotWidth / 2} y={height - 7} textAnchor="middle" className="volume-oi-axis">Open Interest</text>
          <text x="13" y={padding.top + plotHeight / 2} textAnchor="middle" className="volume-oi-axis" transform={`rotate(-90 13 ${padding.top + plotHeight / 2})`}>24h Volume</text>
          <text x={width - padding.right} y={padding.top + 9} textAnchor="end" className="volume-oi-axis">{scale === 'log' ? 'Log scale' : 'Linear scale'}</text>
          {lowerReference < upperReference && <text x={x(upperReference)} y={y(upperReference) - 5} textAnchor="end" className="volume-oi-reference-label">1.0x</text>}
        </svg>
      </div>
      {selected && (
        <div className="volume-oi-selected">
          <strong>{selected.name}</strong>
          <span>#{selected.volumeRank} volume · #{selected.openInterestRank} OI · {formatRatio(selected.volumeOiRatio)} turnover</span>
          <span>{formatShare(selected.volumeShare)} volume share · {formatShare(selected.openInterestShare)} OI share</span>
        </div>
      )}
    </>
  );
}

function RatioList({ title, protocols }) {
  const rows = (Array.isArray(protocols) ? protocols : []).slice(0, 3).filter((protocol) => protocol?.slug && Number.isFinite(protocol?.volumeOiRatio));
  return (
    <section className="volume-oi-ratio-list">
      <h3>{title}</h3>
      {rows.map((protocol) => <div key={protocol.slug}><span>#{protocol.ratioRank} {protocol.name}</span><strong>{formatRatio(protocol.volumeOiRatio)}</strong></div>)}
      {!rows.length && <p>No comparable protocols.</p>}
    </section>
  );
}

export default function VolumeOiAnalysis() {
  const [scale, setScale] = useState(null);
  const [selectedSlug, setSelectedSlug] = useState(null);
  const { data, loading, error, refetch } = useVolumeOiAnalysisData();
  const protocols = safePoints(data?.protocols);
  const coverage = data?.coverage;
  const capturedAt = formatCapturedAt(data?.capturedAt);
  const suggestedScale = useMemo(() => {
    const values = protocols.flatMap((protocol) => [protocol.volume24h, protocol.openInterest]).filter((value) => value > 0);
    if (values.length < 2) return 'linear';
    return Math.max(...values) / Math.min(...values) >= 20 ? 'log' : 'linear';
  }, [protocols]);
  const activeScale = scale || suggestedScale;

  return (
    <section className="card volume-oi-analysis" aria-label="Volume versus Open Interest">
      <div className="market-share-head">
        <div>
          <span className="analytics-module-kicker">Volume vs Open Interest</span>
          <h2>Trading activity relative to open positions</h2>
          {!loading && coverage && <p>Scatter coverage: {coverage.scatterEligible} / {coverage.total} protocols <span>Volume {coverage.volumeAvailable} / {coverage.total} · OI {coverage.openInterestAvailable} / {coverage.total}</span></p>}
        </div>
        <div className="market-share-control-group" aria-label="Chart scale">
          <button type="button" className={activeScale === 'linear' ? 'is-active' : ''} onClick={() => setScale('linear')}>Linear</button>
          <button type="button" className={activeScale === 'log' ? 'is-active' : ''} onClick={() => setScale('log')}>Log</button>
        </div>
      </div>

      {loading && <div className="market-share-loading volume-oi-loading" aria-label="Loading Volume versus Open Interest"><i /><i /><i /><i /></div>}
      {!loading && error && <div className="market-share-empty volume-oi-empty"><strong>Volume vs OI data is temporarily unavailable.</strong><button type="button" onClick={refetch}>Retry</button></div>}
      {!loading && !error && !data?.snapshotDate && <div className="market-share-empty volume-oi-empty"><strong>No canonical daily snapshot is available yet.</strong><span>It will appear after the first successful collection.</span></div>}
      {!loading && !error && data?.snapshotDate && protocols.length < 2 && <div className="market-share-empty volume-oi-empty"><strong>Not enough protocols currently report both Volume and Open Interest.</strong><span>Protocols with missing metrics remain excluded until a canonical snapshot contains both values.</span></div>}
      {!loading && !error && data?.snapshotDate && protocols.length >= 2 && (
        <>
          <div className="volume-oi-meta">Snapshot: {formatDate(data.snapshotDate)}{capturedAt ? ` · Captured at ${capturedAt} UTC` : ''} · Higher Volume/OI means more 24h turnover relative to open positions.</div>
          <ScatterChart protocols={protocols} scale={activeScale} selectedSlug={selectedSlug} onSelect={setSelectedSlug} snapshotDate={data.snapshotDate} />
          <div className="volume-oi-rankings">
            <RatioList title="Highest Volume / OI" protocols={data.highestRatios} />
            <RatioList title="Lowest Volume / OI" protocols={data.lowestRatios} />
            {Number.isFinite(data.medianRatio) && <span className="volume-oi-median">Median: <strong>{formatRatio(data.medianRatio)}</strong></span>}
          </div>
          {coverage?.missing > 0 && <details className="market-share-missing volume-oi-missing"><summary>{coverage.missing} tracked protocols are missing Volume or OI for this snapshot</summary><span>{(Array.isArray(data.missingProtocols) ? data.missingProtocols : []).map((protocol) => protocol?.name).filter(Boolean).join(', ')}</span></details>}
        </>
      )}
    </section>
  );
}
