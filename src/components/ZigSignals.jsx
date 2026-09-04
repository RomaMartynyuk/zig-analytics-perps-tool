import { useState } from 'react';
import AnalyticsCredit from './AnalyticsCredit';
import { useSignalsData } from '../hooks/useSignalsData';

const PERIODS = [['all', 'All'], ['current', 'Current'], ['7d', '7D'], ['30d', '30D'], ['90d', '90D']];
const CATEGORIES = [['all', 'All'], ['activity', 'Activity'], ['open_interest', 'OI'], ['market_share', 'Share'], ['growth', 'Growth'], ['structure', 'Structure']];
function date(value) { return value ? new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', month: 'short', day: 'numeric' }).format(new Date(`${String(value).slice(0, 10)}T00:00:00Z`)) : '—'; }

export default function ZigSignals() {
  const [period, setPeriod] = useState('all'); const [category, setCategory] = useState('all'); const [expanded, setExpanded] = useState(null);
  const { data, loading, error, refetch } = useSignalsData(period, category);
  const signals = data?.signals || [];
  return <section className="card zig-signals" aria-label="Zig Signals"><div className="market-share-head"><div><span className="analytics-module-kicker">Zig Signals</span><h2>What stands out across the tracked Perp DEX market</h2>{!loading && data && <p>{signals.length} research signals detected · Last scan: {date(data.snapshotDate)} <span>Volume {data.coverage.volumeAvailable}/{data.coverage.total} · OI {data.coverage.oiAvailable}/{data.coverage.total} · TVL {data.coverage.tvlAvailable}/{data.coverage.total}</span></p>}</div><div className="zig-signals-controls"><div className="market-share-control-group">{PERIODS.map(([id, label]) => <button key={id} type="button" className={period === id ? 'is-active' : ''} onClick={() => setPeriod(id)}>{label}</button>)}</div><div className="market-share-control-group">{CATEGORIES.map(([id, label]) => <button key={id} type="button" className={category === id ? 'is-active' : ''} onClick={() => setCategory(id)}>{label}</button>)}</div></div></div>
    {loading && <div className="market-share-loading"><i /><i /><i /><i /></div>}
    {!loading && error && <div className="market-share-empty"><strong>Zig Signals data is temporarily unavailable.</strong><button type="button" onClick={refetch}>Retry</button></div>}
    {!loading && !error && !signals.length && <div className="market-share-empty zig-signals-empty"><strong>No strong signals detected</strong><span>Tracked market conditions are currently within normal ranges.</span></div>}
    {!loading && !error && signals.length > 0 && <div className="zig-signals-grid">{signals.map((item) => <article key={item.id} className="zig-signal-card"><div><span className={`zig-signal-severity ${item.severity}`}>{item.severity}</span><span className="zig-signal-period">{item.period}</span></div><h3>{item.title}</h3><strong>{item.protocolName}</strong><div className="zig-signal-evidence">{item.evidence.slice(0, 3).map((evidence) => <span key={evidence.label}>{evidence.label}<b>{evidence.formatted}</b></span>)}</div><p>{item.summary}</p><button type="button" onClick={() => setExpanded(expanded === item.id ? null : item.id)}>Worth investigating →</button>{expanded === item.id && <div className="zig-signal-why"><strong>Why this signal?</strong>{item.comparison && <span>{item.comparison.type.replace('_', ' ')}: {item.comparison.formatted}</span>}<span>Snapshot: {date(item.snapshotDate)}</span><span>{item.researchPrompt}</span></div>}</article>)}</div>}
    {!loading && data?.history && <div className="zig-signals-history">Historical signals: {Object.entries(data.history).map(([key, value]) => <span key={key}>{key.toUpperCase()}: {value.available ? 'ready' : `${value.availableDays}/${value.requiredDays} collecting`}</span>)}</div>}<AnalyticsCredit /></section>;
}
