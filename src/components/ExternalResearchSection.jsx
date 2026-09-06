import { useState } from 'react';
import { runExternalCaseResearch } from '../hooks/useResearchFeedData';

function date(value) { return value ? new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', month: 'short', day: 'numeric', year: 'numeric' }).format(new Date(value)) : 'Date unavailable'; }

function FindingCard({ finding }) {
  return <article className={`external-finding ${finding.confidence?.toLowerCase()}`}>
    <div className="external-finding-top"><span>{String(finding.category || 'OTHER').replaceAll('_', ' ')}</span><b>{finding.confidence}</b></div>
    <h3>{finding.title}</h3>
    <p className="external-finding-meta">{date(finding.eventDate || finding.publishedAt)} · {finding.sourceName || 'Source unavailable'} · {finding.sourceType}</p>
    <div><strong>{finding.confidence === 'LOW' ? 'Reported context' : 'Verified event'}</strong><p>{finding.summary}</p></div>
    <div><strong>Possible relevance</strong><p>{finding.possibleRelevance}</p></div>
    <a href={finding.url} target="_blank" rel="noreferrer">Open source ↗</a>
  </article>;
}

export default function ExternalResearchSection({ caseItem, initialResearch, onComplete }) {
  const [window, setWindow] = useState(initialResearch?.researchWindow?.key || (caseItem.period === '30d' || caseItem.period === '90d' ? '30d' : '7d'));
  const [research, setResearch] = useState(initialResearch); const [loading, setLoading] = useState(false); const [error, setError] = useState(null);
  const launch = async (refresh = false) => { setLoading(true); setError(null); try { const result = await runExternalCaseResearch(caseItem.id, window, refresh); setResearch(result); onComplete?.(result); } catch (err) { setError(err.message || 'External research provider unavailable.'); } finally { setLoading(false); } };
  const findings = research?.findings || [];
  return <section className="protocol-section protocol-external" aria-label="External context">
    <div className="external-heading"><div><span className="analytics-module-kicker">External context</span><p>Verifiable events that may be relevant to this data observation. Events are not treated as causes.</p></div><div className="external-controls"><div>{['7d', '30d'].map((value) => <button type="button" key={value} className={window === value ? 'is-active' : ''} disabled={loading} onClick={() => setWindow(value)}>{value.toUpperCase()}</button>)}</div><button type="button" className="external-run" disabled={loading} onClick={() => launch(Boolean(research))}>{loading ? 'Researching…' : research ? 'Refresh research' : 'Research external context'}</button></div></div>
    {!research && !loading && !error && <div className="external-empty"><strong>No external research performed yet.</strong><span>Searches are anchored to the canonical case date and run only when requested.</span></div>}
    {loading && <div className="external-loading"><span>Searching targeted sources and ranking verifiable context…</span></div>}
    {error && <div className="external-empty external-error"><strong>{error.includes('storage') ? 'External research needs a database migration.' : 'External research provider unavailable.'}</strong><span>{error}</span><button type="button" onClick={() => launch(false)}>Retry</button></div>}
    {research && !loading && <>
      <p className="external-run-meta">Researched {date(research.researchedAt)} · Using data case: {date(caseItem.snapshotDate)} · Window: {date(research.researchWindow.from)} – {date(research.researchWindow.to)}{research.status === 'PARTIAL' ? ' · Partial provider coverage' : ''}</p>
      <div className="external-summary"><strong>What we found</strong><span>{research.summary?.totalFindings || 0} research result{research.summary?.totalFindings === 1 ? '' : 's'} · {research.summary?.highConfidence || 0} high-confidence · {research.summary?.officialSources || 0} official source{research.summary?.officialSources === 1 ? '' : 's'}</span></div>
      {!findings.length && <div className="external-empty"><strong>No relevant external events found.</strong><span>Zig did not find strong verifiable developments within this selected research window.</span></div>}
      {findings.length > 0 && <><div className="external-timeline">{[...findings].sort((a, b) => String(a.eventDate || a.publishedAt).localeCompare(String(b.eventDate || b.publishedAt))).map((finding) => <div key={`timeline-${finding.id || finding.url}`}><time>{date(finding.eventDate || finding.publishedAt)}</time><span>{String(finding.category).replaceAll('_', ' ')}</span></div>)}<div className="zig-snapshot-event"><time>{date(caseItem.snapshotDate)}</time><span>Zig snapshot · {caseItem.headline}</span></div></div><div className="external-findings">{findings.filter((item) => item.confidence !== 'LOW').map((item) => <FindingCard key={item.id || item.url} finding={item} />)}</div>{findings.some((item) => item.confidence === 'LOW') && <details className="external-low-confidence"><summary>Low-confidence context</summary><div className="external-findings">{findings.filter((item) => item.confidence === 'LOW').map((item) => <FindingCard key={item.id || item.url} finding={item} />)}</div></details>}</>}
      <details className="external-queries"><summary>Search queries</summary>{(research.queries || []).map((item) => <span key={item.query}>{item.query}</span>)}</details>
    </>}
  </section>;
}
