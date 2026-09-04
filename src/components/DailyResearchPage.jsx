import { useState } from 'react';
import { formatUSD } from '../lib/format';
import { getLogoUrl } from '../lib/projectLogos';
import { setResearchCaseStatus, useResearchFeedData } from '../hooks/useResearchFeedData';
import AnalyticsCredit from './AnalyticsCredit';

const FILTERS = [['active', 'All active'], ['unreviewed', 'Unreviewed'], ['WATCHING', 'Watching'], ['RESEARCHING', 'Researching'], ['IGNORED', 'Ignored']];
const ACTIONS = [['IGNORED', 'Ignore'], ['WATCHING', 'Watch'], ['RESEARCHING', 'Research']];

function date(value) {
  if (!value) return '—';
  return new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', month: 'short', day: 'numeric', year: 'numeric' }).format(new Date(`${String(value).slice(0, 10)}T00:00:00.000Z`));
}
function metric(value, format) { return value == null ? '—' : format(value); }
function historyProgress(history) { return Object.entries(history || {}).map(([period, item]) => `${period.toUpperCase()} ${item.available ? 'ready' : `${item.availableDays}/${item.requiredDays}`}`).join(' · '); }

function StatusActions({ item, onUpdate, updating }) {
  return <div className="research-status-actions" aria-label="Research status">
    {ACTIONS.map(([value, label]) => <button type="button" key={value} className={item.status === value ? 'is-active' : ''} disabled={updating} onClick={() => onUpdate(item, item.status === value ? null : value)}>{label}</button>)}
  </div>;
}

function ResearchCard({ item, rank, onUpdate, updating }) {
  const [expanded, setExpanded] = useState(false); const snapshot = item.marketSnapshot;
  return <article className={`research-case ${expanded ? 'is-expanded' : ''}`}>
    <div className="research-case-top"><span className="research-rank">{String(rank).padStart(2, '0')}</span><div className="research-protocol"><img src={getLogoUrl(item.protocol.name) || ''} alt="" onError={(event) => { event.currentTarget.style.display = 'none'; }} /><strong>{item.protocol.name}</strong></div><span className={`research-severity ${item.severity}`}>{item.severity}</span><span className="research-period">{item.period}</span></div>
    <h2>{item.headline}</h2><p>{item.summary}</p>
    <div className="research-evidence">{item.evidence.map((entry) => <span key={entry.key}><small>{entry.label}</small><b>{entry.formatted}</b></span>)}</div>
    {item.relatedSignals.length > 0 && <span className="research-related">{item.relatedSignals.length} related observation{item.relatedSignals.length === 1 ? '' : 's'}</span>}
    <div className="research-case-actions"><button type="button" className="research-open" onClick={() => setExpanded(!expanded)}>{expanded ? 'Close research ↑' : 'Open research →'}</button><StatusActions item={item} onUpdate={onUpdate} updating={updating} /></div>
    {expanded && <div className="research-detail">
      <section><h3>Why this was flagged</h3><div className="research-detail-grid"><span>Score<b>{item.score}/100</b></span><span>Period<b>{item.period}</b></span><span>Snapshot<b>{date(item.snapshotDate)}</b></span>{item.primarySignal.comparison && <span>{item.primarySignal.comparison.type.replaceAll('_', ' ')}<b>{item.primarySignal.comparison.formatted}</b></span>}</div></section>
      <section><h3>Current market snapshot</h3><div className="research-detail-grid"><span>24h Volume<b>{metric(snapshot?.volume24h, formatUSD)}</b></span><span>Open Interest<b>{metric(snapshot?.openInterest, formatUSD)}</b></span><span>TVL<b>{metric(snapshot?.tvl, formatUSD)}</b></span><span>Markets<b>{snapshot?.marketsCount ?? '—'}</b></span><span>Volume Share<b>{snapshot?.volumeShare == null ? '—' : `${snapshot.volumeShare.toFixed(1)}%`}</b></span><span>OI Share<b>{snapshot?.oiShare == null ? '—' : `${snapshot.oiShare.toFixed(1)}%`}</b></span><span>Volume / OI<b>{snapshot?.volumeOiRatio == null ? '—' : `${snapshot.volumeOiRatio.toFixed(2)}x`}</b></span></div>{snapshot?.dataSource && <small className="research-source">Source: {snapshot.dataSource}</small>}</section>
      {item.relatedSignals.length > 0 && <section><h3>Related signals</h3>{item.relatedSignals.map((signal) => <div className="research-related-detail" key={signal.id}><strong>{signal.title}</strong><span>{signal.evidence?.map((evidence) => `${evidence.label}: ${evidence.formatted}`).join(' · ') || signal.summary}</span></div>)}</section>}
      <section className="research-questions"><h3>Questions to investigate</h3><div><strong>Zig can check</strong>{item.questions.zigCanCheck.map((question) => <span key={question}>{question}</span>)}</div><div><strong>External research</strong>{item.questions.externalResearch.map((question) => <span key={question}>{question}</span>)}</div></section>
    </div>}
  </article>;
}

export default function DailyResearchPage() {
  const [filter, setFilter] = useState('active'); const [saving, setSaving] = useState(null); const [updateError, setUpdateError] = useState(null);
  const { data, loading, error, refetch } = useResearchFeedData(filter);
  const update = async (item, status) => { setSaving(item.id); setUpdateError(null); try { await setResearchCaseStatus(item.id, status); refetch(); } catch { setUpdateError('Unable to save the research status.'); } finally { setSaving(null); } };
  const cases = data?.cases || [];
  return <section className="daily-research-page" aria-label="Daily Research Feed">
    <div className="daily-research-heading"><div><span className="analytics-kicker">Research workspace · 03</span><h1>Daily research feed</h1><p>What deserves attention across tracked Perp DEXs.</p>{!loading && data && <span className="research-through">Data through {date(data.snapshotDate)} · {data.summary.researchCases} research case{data.summary.researchCases === 1 ? '' : 's'}</span>}</div><div className="research-filters">{FILTERS.map(([id, label]) => <button type="button" key={id} className={filter === id ? 'is-active' : ''} onClick={() => setFilter(id)}>{label}</button>)}</div></div>
    {loading && <div className="daily-research-loading">{Array.from({ length: 3 }, (_, index) => <i key={index} />)}</div>}
    {!loading && error && <div className="daily-research-empty"><strong>Daily Research Feed is temporarily unavailable.</strong><button type="button" onClick={refetch}>Retry</button></div>}
    {!loading && !error && !cases.length && <div className="daily-research-empty"><strong>No strong research cases today</strong><span>Tracked market conditions are currently within normal ranges.</span></div>}
    {!loading && !error && cases.length > 0 && <div className="research-case-list">{cases.map((item, index) => <ResearchCard key={item.id} item={item} rank={index + 1} onUpdate={update} updating={saving === item.id} />)}</div>}
    {updateError && <p className="research-update-error">{updateError}</p>}
    {!loading && data?.history && <p className="research-history">History: {historyProgress(data.history)}</p>}
    <AnalyticsCredit />
  </section>;
}
