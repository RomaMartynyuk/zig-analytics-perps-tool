import { useMemo, useState } from 'react';
import { runExternalCaseResearch } from '../hooks/useResearchFeedData';

function date(value) {
  return value ? new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', month: 'short', day: 'numeric', year: 'numeric' }).format(new Date(value)) : 'Date unavailable';
}

function sourceLabel(value) {
  return ({
    OFFICIAL_PROTOCOL: 'Official', OFFICIAL_PARTNER: 'Partner', GOVERNANCE: 'Governance', MEDIA: 'Media', COMMUNITY: 'Community', OTHER: 'Other',
    official: 'Official', partner: 'Partner', secondary: 'Media', other: 'Other',
  })[value] || 'Other';
}

function FindingCard({ finding }) {
  const sourceType = sourceLabel(finding.sourceType);
  return <article className={`external-finding ${finding.confidence?.toLowerCase()}`}>
    <div className="external-finding-top"><span>{String(finding.category || 'OTHER').replaceAll('_', ' ')}</span><b>{finding.confidence}</b></div>
    <h3>{finding.title}</h3>
    <p className="external-finding-meta">{finding.eventDate ? `Event ${date(finding.eventDate)}` : finding.publishedAt ? `Published ${date(finding.publishedAt)}` : 'Date unavailable'} · {finding.sourceName || 'Source unavailable'} · {sourceType}</p>
    <div><strong>{finding.confidence === 'LOW' ? 'Reported context' : 'Verified event'}</strong><p>{finding.factualSummary || finding.summary}</p></div>
    <div><strong>Why this may matter</strong><p>{finding.possibleRelevance}</p></div>
    {finding.supportingSources?.length > 0 && <details className="external-supporting"><summary>{finding.supportingSources.length} supporting source{finding.supportingSources.length === 1 ? '' : 's'}</summary>{finding.supportingSources.map((source) => <a key={source.url} href={source.url} target="_blank" rel="noopener noreferrer">{source.sourceName || source.title} ↗</a>)}</details>}
    <a href={finding.url} target="_blank" rel="noopener noreferrer">Open source ↗</a>
  </article>;
}

function ResearchTimeline({ findings, caseItem }) {
  const events = useMemo(() => [
    ...findings.map((finding) => ({ id: finding.id || finding.url, date: finding.eventDate || finding.publishedAt, label: String(finding.category || 'OTHER').replaceAll('_', ' '), snapshot: false })),
    { id: `snapshot-${caseItem.id}`, date: caseItem.snapshotDate, label: `Zig snapshot · ${caseItem.headline}`, snapshot: true },
  ].filter((item) => item.date).sort((left, right) => String(left.date).localeCompare(String(right.date)) || Number(left.snapshot) - Number(right.snapshot)), [findings, caseItem]);
  return <div className="external-timeline" aria-label="Research timeline">{events.map((item) => <div key={item.id} className={item.snapshot ? 'zig-snapshot-event' : ''}><time>{date(item.date)}</time><span>{item.label}</span>{item.snapshot && caseItem.summary && <small>{caseItem.summary}</small>}</div>)}</div>;
}

export default function ExternalResearchSection({ caseItem, initialResearch, onComplete }) {
  const initialWindow = initialResearch?.researchWindow?.key === '30d' ? '30d' : 'default';
  const [window, setWindow] = useState(initialWindow);
  const [research, setResearch] = useState(initialResearch);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const visibleResearch = research?.researchWindow?.key === window || (window === 'default' && research?.researchWindow?.key === '7d') ? research : null;
  const findings = visibleResearch?.findings || [];

  const launch = async (refresh = false) => {
    setLoading(true); setError(null);
    try { const result = await runExternalCaseResearch(caseItem.id, window, refresh); setResearch(result); onComplete?.(result); }
    catch (err) { setError(err.message || 'External research is temporarily unavailable.'); }
    finally { setLoading(false); }
  };

  return <section className="protocol-section protocol-external" aria-label="External context">
    <div className="external-heading">
      <div><span className="analytics-module-kicker">External context</span><p>Verifiable developments near this Zig observation. Temporal relevance is not evidence of causation.</p></div>
      <div className="external-controls">
        <div>{[['default', 'Default'], ['30d', '30D']].map(([value, label]) => <button type="button" key={value} className={window === value ? 'is-active' : ''} disabled={loading} onClick={() => setWindow(value)}>{label}</button>)}</div>
        <button type="button" className="external-run" disabled={loading} onClick={() => launch(Boolean(visibleResearch))}>{loading ? 'Researching…' : visibleResearch ? 'Refresh research' : 'Research external context'}</button>
      </div>
    </div>

    {!visibleResearch && !loading && !error && <div className="external-empty"><strong>No external research has been performed for this Research Case.</strong><span>Research runs only when requested and remains anchored to the canonical case date.</span></div>}
    {loading && <div className="external-loading" role="status"><i /><strong>Researching external context</strong><span>Searching protocol updates and checking relevant external events…</span></div>}
    {error && <div className="external-empty external-error"><strong>External research is temporarily unavailable.</strong><span>{error}</span><button type="button" onClick={() => launch(false)}>Retry</button></div>}

    {visibleResearch?.status === 'FAILED' && !loading && <div className="external-empty external-error"><strong>External research provider is unavailable.</strong><span>{visibleResearch.error || 'No provider query completed. Internal Zig research remains available.'}</span><button type="button" onClick={() => launch(true)}>Retry</button></div>}

    {visibleResearch && visibleResearch.status !== 'FAILED' && !loading && <>
      <p className="external-run-meta">Researched {date(visibleResearch.researchedAt)} · Case snapshot {date(caseItem.snapshotDate)} · Research window {date(visibleResearch.researchWindow.from)} – {date(visibleResearch.researchWindow.to)}{visibleResearch.status === 'PARTIAL' ? ' · Partial provider coverage' : ''}</p>
      <div className="external-summary"><strong>External context</strong><span>{visibleResearch.summary?.totalFindings || 0} relevant event{visibleResearch.summary?.totalFindings === 1 ? '' : 's'} · {visibleResearch.summary?.highConfidence || 0} high-confidence · {visibleResearch.summary?.officialSources || 0} official source{visibleResearch.summary?.officialSources === 1 ? '' : 's'}</span></div>
      {!findings.length && <div className="external-empty"><strong>No strong external context found.</strong><span>No sufficiently relevant verified events were found within the selected research window.</span></div>}
      {findings.length > 0 && <>
        <ResearchTimeline findings={findings} caseItem={caseItem} />
        <div className="external-findings">{findings.map((item) => <FindingCard key={item.id || item.url} finding={item} />)}</div>
      </>}
      <details className="external-queries"><summary>Research details</summary><span>Provider: {visibleResearch.provider}</span><span>Results reviewed: {visibleResearch.summary?.resultCount ?? '—'}</span><span>Suppressed: {visibleResearch.summary?.suppressed ?? '—'}</span><span>Query failures: {visibleResearch.summary?.queryFailures ?? 0}</span>{(visibleResearch.queries || []).map((item) => <span key={item.query}>{item.query}</span>)}</details>
    </>}
  </section>;
}
