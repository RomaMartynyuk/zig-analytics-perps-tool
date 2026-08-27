import { useMemo, useState } from 'react';
import { formatUSD } from '../lib/format';
import { getProtocolColor } from '../lib/marketShare';
import { useVolumeOiAnalysisData } from '../hooks/useVolumeOiAnalysisData';

function formatDate(value) {
  if (!value) return '—';
  return new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', month: 'short', day: 'numeric', year: 'numeric' })
    .format(new Date(`${String(value).slice(0, 10)}T00:00:00.000Z`));
}

function formatShare(value) {
  return Number.isFinite(value) ? `${value.toFixed(1)}%` : '—';
}

function formatGap(value) {
  return Number.isFinite(value) ? `${value > 0 ? '+' : ''}${value.toFixed(1)}pp` : '—';
}

function safePoints(protocols) {
  return (Array.isArray(protocols) ? protocols : []).filter((protocol) => (
    protocol?.slug && protocol?.name && Number.isFinite(protocol?.volume24h)
    && Number.isFinite(protocol?.openInterest) && protocol.volume24h > 0 && protocol.openInterest > 0
    && Number.isFinite(protocol?.volumeShare) && Number.isFinite(protocol?.openInterestShare)
    && Number.isFinite(protocol?.shareGapPp)
  ));
}

function ShareScatter({ protocols, selectedSlug, onSelect, snapshotDate }) {
  const points = useMemo(() => safePoints(protocols), [protocols]);
  const highlighted = useMemo(() => new Set(points.slice().sort((a, b) => Math.abs(b.shareGapPp) - Math.abs(a.shareGapPp)).slice(0, 3).map((point) => point.slug)), [points]);
  if (points.length < 2) return null;

  const width = 550;
  const height = 225;
  const padding = { top: 14, right: 18, bottom: 36, left: 45 };
  const plotWidth = width - padding.left - padding.right;
  const plotHeight = height - padding.top - padding.bottom;
  const maxShare = Math.max(...points.flatMap((point) => [point.volumeShare, point.openInterestShare]));
  const bound = Math.max(5, Math.ceil(maxShare * 1.08 / 5) * 5);
  const x = (share) => padding.left + (share / bound) * plotWidth;
  const y = (share) => padding.top + (1 - share / bound) * plotHeight;
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((fraction) => bound * fraction);
  const selected = points.find((point) => point.slug === selectedSlug);

  return (
    <>
      <div className="volume-oi-share-chart" aria-label="Volume share versus Open Interest share scatter chart">
        <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`Volume share versus open interest share on ${formatDate(snapshotDate)}`}>
          {ticks.map((tick) => <g key={tick}>
            <line x1={padding.left} x2={width - padding.right} y1={y(tick)} y2={y(tick)} className="volume-oi-gridline" />
            <line x1={x(tick)} x2={x(tick)} y1={padding.top} y2={padding.top + plotHeight} className="volume-oi-gridline" />
            <text x={padding.left - 6} y={y(tick) + 3} textAnchor="end" className="volume-oi-axis">{tick.toFixed(0)}%</text>
            <text x={x(tick)} y={height - 19} textAnchor="middle" className="volume-oi-axis">{tick.toFixed(0)}%</text>
          </g>)}
          <line x1={padding.left} y1={padding.top + plotHeight} x2={width - padding.right} y2={padding.top} className="volume-oi-reference" />
          <text x={width - padding.right} y={padding.top + 10} textAnchor="end" className="volume-oi-reference-label">Volume share = OI share</text>
          <text x={padding.left + plotWidth / 2} y={height - 5} textAnchor="middle" className="volume-oi-axis">OI Share (%)</text>
          <text x="12" y={padding.top + plotHeight / 2} textAnchor="middle" className="volume-oi-axis" transform={`rotate(-90 12 ${padding.top + plotHeight / 2})`}>Volume Share (%)</text>
          {points.map((point) => {
            const selectedPoint = point.slug === selectedSlug;
            return <g key={point.slug} className="volume-oi-point" onMouseEnter={() => onSelect(point.slug)} onFocus={() => onSelect(point.slug)} onClick={() => onSelect(point.slug)} onKeyDown={(event) => event.key === 'Enter' && onSelect(point.slug)} tabIndex="0" role="button" aria-label={`Select ${point.name}`}>
              <circle cx={x(point.openInterestShare)} cy={y(point.volumeShare)} r={selectedPoint ? 6.5 : 5} fill={getProtocolColor(point.slug)} className={selectedPoint ? 'is-selected' : ''} />
              <title>{`${point.name}\n24h Volume: ${formatUSD(point.volume24h)}\nOpen Interest: ${formatUSD(point.openInterest)}\nVolume Share: ${formatShare(point.volumeShare)}\nOI Share: ${formatShare(point.openInterestShare)}\nShare Gap: ${formatGap(point.shareGapPp)}\nSnapshot: ${formatDate(snapshotDate)}\nSource: ${point.dataSource || '—'}`}</title>
              {highlighted.has(point.slug) && <text x={x(point.openInterestShare) + 7} y={y(point.volumeShare) - 7} className="volume-oi-label">{point.name}</text>}
            </g>;
          })}
        </svg>
      </div>
      {selected && <div className="volume-oi-selected volume-oi-share-selected"><strong>{selected.name}</strong><span>#{selected.volumeRank} volume · #{selected.openInterestRank} OI · Gap {formatGap(selected.shareGapPp)}</span><span>{formatShare(selected.volumeShare)} volume share · {formatShare(selected.openInterestShare)} OI share</span></div>}
    </>
  );
}

function GapList({ title, protocols, direction }) {
  const rows = (Array.isArray(protocols) ? protocols : []).slice(0, 3).filter((protocol) => protocol?.slug && Number.isFinite(protocol?.shareGapPp));
  return <section className={`volume-oi-ratio-list volume-oi-gap-list ${direction}`}><h3>{title}</h3>{rows.map((protocol) => <div key={protocol.slug}><span>#{protocol.gapRank} {protocol.name}</span><strong>{formatGap(protocol.shareGapPp)}</strong></div>)}{!rows.length && <p>No material share gaps.</p>}</section>;
}

export default function VolumeOiShareAnalysis() {
  const [selectedSlug, setSelectedSlug] = useState(null);
  const { data, loading, error, refetch } = useVolumeOiAnalysisData();
  const protocols = safePoints(data?.protocols);
  const coverage = data?.coverage;

  return <section className="card volume-oi-share-analysis" aria-label="Volume Share versus Open Interest Share">
    <div className="market-share-head"><div><span className="analytics-module-kicker">Volume Share vs OI Share</span><h2>Trading activity share compared with open position share</h2>{!loading && coverage && <p>Eligible: {coverage.scatterEligible} / {coverage.total} protocols <span>Volume {coverage.volumeAvailable} / {coverage.total} · OI {coverage.openInterestAvailable} / {coverage.total}</span></p>}</div></div>
    {loading && <div className="market-share-loading volume-oi-loading" aria-label="Loading volume share versus open interest share"><i /><i /><i /><i /></div>}
    {!loading && error && <div className="market-share-empty volume-oi-share-empty"><strong>Volume Share vs OI Share data is temporarily unavailable.</strong><button type="button" onClick={refetch}>Retry</button></div>}
    {!loading && !error && !data?.snapshotDate && <div className="market-share-empty volume-oi-share-empty"><strong>No canonical daily snapshot is available yet.</strong></div>}
    {!loading && !error && data?.snapshotDate && protocols.length < 2 && <div className="market-share-empty volume-oi-share-empty"><strong>Not enough protocols currently report both Volume and Open Interest.</strong></div>}
    {!loading && !error && data?.snapshotDate && protocols.length >= 2 && <>
      <div className="volume-oi-meta">Snapshot: {formatDate(data.snapshotDate)} · The gap compares a protocol&apos;s tracked 24h Volume share with its Open Interest share.</div>
      <ShareScatter protocols={protocols} selectedSlug={selectedSlug} onSelect={setSelectedSlug} snapshotDate={data.snapshotDate} />
      <div className="volume-oi-rankings volume-oi-gap-rankings"><GapList title="Volume share > OI share" protocols={data.largestPositiveGaps} direction="positive" /><GapList title="OI share > Volume share" protocols={data.largestNegativeGaps} direction="negative" /></div>
      {coverage?.missing > 0 && <details className="market-share-missing volume-oi-missing"><summary>{coverage.missing} tracked protocols are missing Volume or OI for this snapshot</summary><span>{(Array.isArray(data.missingProtocols) ? data.missingProtocols : []).map((protocol) => protocol?.name).filter(Boolean).join(', ')}</span></details>}
    </>}
  </section>;
}
