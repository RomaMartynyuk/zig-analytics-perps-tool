import { useMemo, useState } from 'react';
import { formatUSD } from '../lib/format';
import { growthSortValue, sortGrowthRows } from '../lib/growthMatrix';
import { useGrowthMatrixData } from '../hooks/useGrowthMatrixData';

const PERIODS = [{ id: '7d', label: '7D' }, { id: '30d', label: '30D' }, { id: '90d', label: '90D' }];
const COLUMNS = [
  { id: 'volume', label: 'Volume', kind: 'growth', coverage: 'volumeComparable' },
  { id: 'openInterest', label: 'Open Interest', kind: 'growth', coverage: 'openInterestComparable' },
  { id: 'tvl', label: 'TVL', kind: 'growth', coverage: 'tvlComparable' },
  { id: 'volumeShare', label: 'Share', kind: 'share', coverage: 'shareComparable' },
];

function formatDate(value) {
  if (!value) return '—';
  return new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', month: 'short', day: 'numeric', year: 'numeric' })
    .format(new Date(`${String(value).slice(0, 10)}T00:00:00.000Z`));
}

function formatChange(value, kind) {
  if (!Number.isFinite(value)) return '—';
  return `${value > 0 ? '+' : ''}${value.toFixed(1)}${kind === 'share' ? 'pp' : '%'}`;
}

function formatLevel(value) {
  return Number.isFinite(value) ? `${value.toFixed(1)}%` : 'Unavailable';
}

function heatStyle(value, columnValues) {
  if (!Number.isFinite(value)) return undefined;
  const absolute = columnValues.map(Math.abs).sort((a, b) => a - b);
  const cap = absolute[Math.max(0, Math.ceil(absolute.length * 0.9) - 1)] || 1;
  const intensity = Math.min(Math.abs(value) / cap, 1) * 0.2 + 0.04;
  return { backgroundColor: value >= 0 ? `rgba(52, 182, 107, ${intensity})` : `rgba(228, 91, 78, ${intensity})` };
}

function cellTooltip(protocol, column, startDate, endDate) {
  const metric = protocol?.[column.id];
  if (!metric) return `${protocol?.name || 'Protocol'} — ${column.label}\nUnavailable for this period`;
  const change = column.kind === 'share' ? metric.changePp : metric.growthPct;
  return `${protocol.name} — ${column.label}\n${formatDate(startDate)}: ${column.kind === 'share' ? formatChange(metric.start, 'growth') : formatUSD(metric.start)}\n${formatDate(endDate)}: ${column.kind === 'share' ? formatChange(metric.current, 'growth') : formatUSD(metric.current)}\n${column.kind === 'share' ? 'Change' : 'Growth'}: ${formatChange(change, column.kind)}\nSource: ${metric.currentDataSource || metric.startDataSource || '—'}`;
}

function momentumLabel(value) {
  if (value === 'broad_growth') return 'Broad growth';
  if (value === 'broad_contraction') return 'Broad contraction';
  if (value === 'mixed') return 'Mixed';
  return '—';
}

export default function GrowthMatrix() {
  const [period, setPeriod] = useState('7d');
  const [sortKey, setSortKey] = useState('volume');
  const [descending, setDescending] = useState(true);
  const [activeCell, setActiveCell] = useState(null);
  const { data, loading, error, refetch } = useGrowthMatrixData(period);
  const periodLabel = PERIODS.find((option) => option.id === period)?.label;
  const protocols = useMemo(() => (Array.isArray(data?.protocols) ? data.protocols : []), [data?.protocols]);
  const columnValues = useMemo(() => Object.fromEntries(COLUMNS.map((column) => [column.id, protocols.map((protocol) => growthSortValue(protocol, column.id)).filter(Number.isFinite)])), [protocols]);
  const sorted = useMemo(() => sortGrowthRows(protocols, sortKey, descending), [protocols, sortKey, descending]);
  const setSort = (key) => {
    if (key === sortKey) setDescending((value) => !value);
    else { setSortKey(key); setDescending(true); }
  };

  return <section className="card growth-matrix" aria-label="Growth Matrix">
    <div className="market-share-head"><div><span className="analytics-module-kicker">Growth Matrix</span><h2>Cross-protocol momentum across key metrics</h2>{!loading && data?.coverage && <p>Comparable: Volume {data.coverage.volumeComparable} / {data.coverage.total} · OI {data.coverage.openInterestComparable} / {data.coverage.total} · TVL {data.coverage.tvlComparable} / {data.coverage.total}</p>}</div><div className="market-share-control-group" aria-label="Growth Matrix period">{PERIODS.map((option) => <button key={option.id} type="button" className={period === option.id ? 'is-active' : ''} onClick={() => setPeriod(option.id)}>{option.label}</button>)}</div></div>
    {loading && <div className="market-share-loading growth-matrix-loading" aria-label="Loading Growth Matrix"><i /><i /><i /><i /><i /></div>}
    {!loading && error && <div className="market-share-empty growth-matrix-empty"><strong>Growth Matrix data is temporarily unavailable.</strong><button type="button" onClick={refetch}>Retry</button></div>}
    {!loading && !error && !data?.sufficientHistory && <div className="market-share-empty growth-matrix-empty"><strong>{periodLabel} Growth Matrix is still being collected</strong><span>Zig has {data?.availableDays || 0} of {data?.requiredDays || 0} required consecutive daily snapshots available.</span><span className="growth-matrix-progress"><i style={{ width: `${Math.min(((data?.availableDays || 0) / (data?.requiredDays || 1)) * 100, 100)}%` }} /></span><span>{data?.availableDays || 0} / {data?.requiredDays || 0}</span><span>This view unlocks automatically as history accumulates.</span></div>}
    {!loading && !error && data?.sufficientHistory && !protocols.length && <div className="market-share-empty growth-matrix-empty"><strong>No comparable protocol history is available for this period.</strong></div>}
    {!loading && !error && data?.sufficientHistory && protocols.length > 0 && <>
      <div className="growth-matrix-meta">{formatDate(data.startDate)} → {formatDate(data.endDate)} · Volume/OI/TVL use percentage growth; Share uses percentage-point change.</div>
      {activeCell && <div className="growth-matrix-inspector" role="status"><strong>{activeCell.protocol.name} · {activeCell.column.label}</strong><span>{formatDate(data.startDate)}: {activeCell.column.kind === 'share' ? formatLevel(activeCell.metric?.start) : formatUSD(activeCell.metric?.start)}</span><span>{formatDate(data.endDate)}: {activeCell.column.kind === 'share' ? formatLevel(activeCell.metric?.current) : formatUSD(activeCell.metric?.current)}</span><b>{activeCell.metric ? formatChange(activeCell.column.kind === 'share' ? activeCell.metric.changePp : activeCell.metric.growthPct, activeCell.column.kind) : 'Unavailable'}</b></div>}
      <div className="growth-matrix-scroll"><table><thead><tr><th className="growth-matrix-dex">DEX</th>{COLUMNS.map((column) => <th key={column.id}><button type="button" onClick={() => setSort(column.id)}>{column.label}{sortKey === column.id ? (descending ? ' ↓' : ' ↑') : ''}</button><small>{data.coverage?.[column.coverage] || 0} comparable</small></th>)}<th>Momentum</th></tr></thead><tbody>{sorted.map((protocol) => <tr key={protocol.slug}><th className="growth-matrix-dex" scope="row">{protocol.name}</th>{COLUMNS.map((column) => { const cell = protocol[column.id]; const value = column.kind === 'share' ? cell?.changePp : cell?.growthPct; return <td key={column.id} tabIndex="0" onMouseEnter={() => setActiveCell({ protocol, column, metric: cell })} onFocus={() => setActiveCell({ protocol, column, metric: cell })} style={heatStyle(value, columnValues[column.id])} title={cellTooltip(protocol, column, data.startDate, data.endDate)}>{formatChange(value, column.kind)}</td>; })}<td className={`growth-matrix-momentum ${protocol.momentum || 'unavailable'}`}>{momentumLabel(protocol.momentum)}</td></tr>)}</tbody></table></div>
      <p className="growth-matrix-note">A protocol can grow in raw Volume while losing tracked Volume Share if the covered market grows faster.</p>
    </>}
  </section>;
}
