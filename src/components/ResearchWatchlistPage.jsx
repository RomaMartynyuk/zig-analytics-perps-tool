import { useMemo, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { getLogoUrl } from '../lib/projectLogos';
import { setResearchCaseStatus, useResearchWatchlist } from '../hooks/useResearchFeedData';
import AnalyticsCredit from './AnalyticsCredit';

const FILTERS = ['ALL', 'CHANGED', 'NEW / REAPPEARED', 'STRENGTHENING', 'WEAKENING', 'RESOLVED', 'NO CHANGE'];
function fmtDate(value) { return value ? new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', month: 'short', day: 'numeric', year: 'numeric' }).format(new Date(`${String(value).slice(0,10)}T00:00:00Z`)) : '—'; }
function state(entry) { return entry.currentState?.lifecycleState || (entry.currentState?.signalState === 'NOT_EVALUABLE' ? 'NOT EVALUABLE' : 'UNAVAILABLE'); }
function strength(value, metric) { if (!Number.isFinite(value)) return '—'; return /pp|share/.test(metric || '') ? `${value.toFixed(1)}pp` : `${value.toFixed(2)}×`; }
function matches(entry, filter) {
  if (filter === 'ALL') return true;
  if (filter === 'CHANGED') return entry.update?.changed;
  if (filter === 'NO CHANGE') return !entry.update?.changed;
  if (filter === 'NEW / REAPPEARED') return entry.update?.type === 'REAPPEARED' || entry.currentState?.lifecycleState === 'NEW';
  return entry.currentState?.lifecycleState === filter;
}

function WatchCard({ entry, onOpen, onUnwatch, saving }) {
  const current = entry.currentState; const previous = entry.previousWatchState; const currentState = state(entry);
  return <article className={`watch-card significance-${(entry.update?.significance || 'none').toLowerCase()}`}>
    <div className="watch-card-head"><div className="watch-protocol"><img src={getLogoUrl(entry.case.protocol?.name) || ''} alt="" onError={(event)=>{event.currentTarget.style.display='none';}} /><div><span>{entry.case.protocol?.name || 'Unavailable protocol'}</span><h2>{entry.case.headline || 'Research case unavailable'}</h2></div></div><div className="watch-badges"><span className={`lifecycle-badge state-${currentState.toLowerCase().replaceAll(' ','-')}`}>{currentState}</span>{entry.update?.changed && <b>{entry.update.type.replaceAll('_',' ')}</b>}</div></div>
    {entry.error ? <div className="watch-entry-error">This watched case could not be evaluated. Other cases remain available.</div> : <>
      <div className="watch-state-grid"><div><small>Original case</small><strong>{fmtDate(entry.originalState?.canonicalDate || entry.case.snapshotDate)}</strong><span>{entry.originalState?.lifecycle?.lifecycleState || entry.originalState?.signalState || '—'} · score {entry.case.originalScore ?? '—'} · {entry.case.originalSeverity || '—'}</span></div><i aria-hidden="true">→</i><div><small>Current watch state</small><strong>{fmtDate(current?.canonicalDate)}</strong><span>{currentState} · {current?.lifecycleConfidence || '—'} confidence · {current?.signalState || '—'}</span></div></div>
      <div className="watch-update"><strong>{entry.update?.explanation || 'Current comparison is unavailable.'}</strong>{previous && <span>{strength(previous.strengthValue, previous.strengthMetric)} → {strength(current?.strengthValue, current?.strengthMetric)}</span>}<small>{entry.lastMeaningfulChange ? `Last meaningful change: ${fmtDate(entry.lastMeaningfulChange.canonicalDate)}` : 'No prior meaningful change recorded.'}</small></div>
    </>}
    <div className="watch-card-actions"><button type="button" className="research-open" onClick={()=>onOpen(entry.case.id)}>Open research →</button><button type="button" disabled={saving} onClick={()=>onUnwatch(entry.case.id)}>Unwatch</button></div>
  </article>;
}

export default function ResearchWatchlistPage({ onOpenCase }) {
  const { data, loading, error, refetch } = useResearchWatchlist(); const [filter,setFilter] = useState('ALL'); const [saving,setSaving] = useState(null);
  const entries = useMemo(()=> (data?.entries || []).filter((entry)=>matches(entry,filter)),[data,filter]);
  const unwatch = async (id) => { setSaving(id); try { await setResearchCaseStatus(id, null); refetch(); } finally { setSaving(null); } };
  return <section className="watchlist-page">
    <header className="watchlist-header"><div><span className="analytics-kicker">Research workspace · 02</span><h1>Watchlist</h1><p>Follow-up state for immutable Research Cases you chose to watch.</p></div><button type="button" className="watch-refresh" onClick={refetch} disabled={loading}><RefreshCw size={14}/> Refresh watchlist</button></header>
    {!loading && !error && data && <><div className="watch-summary"><span><b>{data.summary.watchedCases}</b> watched cases</span><span><b>{data.summary.changedCases}</b> changed</span><span><b>{data.summary.resolved}</b> resolved</span><span><b>{data.summary.reappeared}</b> reappeared</span><span>Data through <b>{fmtDate(data.canonicalDate)}</b></span></div><div className="watch-filters" aria-label="Watchlist filters">{FILTERS.map((item)=><button type="button" key={item} className={filter===item?'is-active':''} onClick={()=>setFilter(item)}>{item}</button>)}</div></>}
    {loading && <div className="daily-research-loading"><i/><i/><i/></div>}
    {error && <div className="daily-research-empty"><strong>Research Watchlist is temporarily unavailable.</strong><button type="button" onClick={refetch}>Retry</button></div>}
    {!loading && !error && data?.summary.watchedCases === 0 && <div className="daily-research-empty"><strong>Your Watchlist is empty.</strong><span>Mark a Research Case as Watching in Daily Research or its dossier.</span></div>}
    {!loading && !error && data?.summary.watchedCases > 0 && entries.length === 0 && <div className="daily-research-empty"><strong>No watched cases match this filter.</strong></div>}
    {entries.length > 0 && <div className="watch-list">{entries.map((entry)=><WatchCard key={entry.case.id} entry={entry} onOpen={onOpenCase} onUnwatch={unwatch} saving={saving===entry.case.id}/>)}</div>}
    <AnalyticsCredit />
  </section>;
}
