import { useEffect, useState } from 'react';
import { buildResearchSynthesis } from '../hooks/useResearchFeedData';

const SOURCE_LABELS = { ZIG_DATA: 'Zig data', EXTERNAL_OFFICIAL: 'Official source', EXTERNAL_PARTNER: 'Partner source', EXTERNAL_MEDIA: 'Media' };

function FactList({ items }) { return <div className="synthesis-facts">{items.map((item) => <article key={item.id}><span>{SOURCE_LABELS[item.sourceType] || item.sourceType}</span><p>{item.text}</p>{item.sourceUrl && <a href={item.sourceUrl} target="_blank" rel="noreferrer">View source</a>}</article>)}</div>; }
function CheckList({ items, scope }) { const selected = items.filter((item) => item.scope === scope); return <div><strong>{scope === 'ZIG_CAN_CHECK' ? 'Zig can check' : 'External research needed'}</strong>{selected.map((item) => <span key={item.id}>{item.text}</span>)}</div>; }

export default function ResearchSynthesisSection({ caseItem, initialState, onComplete }) {
  const [state, setState] = useState(initialState || { latest: null, stale: false }); const [loading, setLoading] = useState(false); const [error, setError] = useState(null);
  useEffect(() => { setState(initialState || { latest: null, stale: false }); setError(null); }, [caseItem.id, initialState]);
  const synthesis = state?.latest;
  const build = async () => { setLoading(true); setError(null); try { const result = await buildResearchSynthesis(caseItem.id, Boolean(synthesis)); const next = { latest: result.synthesis, stale: result.stale }; setState(next); onComplete?.(next); } catch (err) { setError(err.message); } finally { setLoading(false); } };
  return <section className="protocol-section protocol-synthesis" aria-label="Research synthesis">
    <div className="synthesis-heading"><div><span className="analytics-module-kicker">Research synthesis</span><p>Supported facts, possible explanations, unknowns, and evidence gaps.</p></div><button type="button" onClick={build} disabled={loading}>{loading ? 'Building…' : synthesis ? 'Refresh synthesis' : 'Build synthesis'}</button></div>
    {state?.stale && <div className="synthesis-stale"><strong>New external evidence available.</strong><span>The existing synthesis remains unchanged until you refresh it.</span></div>}
    {error && <div className="external-empty external-error"><strong>Research synthesis is temporarily unavailable.</strong><span>{error}</span></div>}
    {!synthesis && !loading && !error && <div className="external-empty"><strong>No synthesis generated yet.</strong><span>Build an evidence-linked memo from this persisted Case and its retained external findings.</span></div>}
    {synthesis && <div className="synthesis-body">
      <section><h3>Confirmed facts</h3><FactList items={synthesis.confirmedFacts || []} /></section>
      <section><h3>External facts</h3>{synthesis.externalFacts?.length ? <FactList items={synthesis.externalFacts} /> : <p>No retained verified external fact is available.</p>}</section>
      <section><h3>Possible explanations</h3>{synthesis.hypotheses?.length ? <div className="synthesis-hypotheses">{synthesis.hypotheses.map((item) => <article key={item.id}><span>{item.status} · {item.confidence}</span><p>{item.text}</p><small>Supporting evidence: {item.supportingEvidenceIds.join(', ')}</small>{item.contradictingEvidenceIds.length > 0 && <small>Contradicting evidence: {item.contradictingEvidenceIds.join(', ')}</small>}<small>Would strengthen: {item.whatWouldStrengthen.join(' ')}</small><small>Would weaken: {item.whatWouldWeaken.join(' ')}</small></article>)}</div> : <p>No evidence-supported explanatory hypothesis is available.</p>}</section>
      <section><h3>What we don’t know</h3><ul>{(synthesis.unknowns || []).map((item) => <li key={item.id}>{item.text}</li>)}</ul></section>
      <section><h3>Next checks</h3><div className="synthesis-checks"><CheckList items={synthesis.nextChecks || []} scope="ZIG_CAN_CHECK" /><CheckList items={synthesis.nextChecks || []} scope="EXTERNAL_RESEARCH_NEEDED" /></div></section>
      <section className="synthesis-conclusion"><h3>Research conclusion</h3><span>{synthesis.conclusion.confidence.replaceAll('_', ' ')}</span><p>{synthesis.conclusion.summary}</p></section>
      <details className="protocol-methodology"><summary>Research details</summary><span>Synthesis version: {synthesis.synthesisVersion}</span><span>Generated: {synthesis.generatedAt}</span><span>Case snapshot: {synthesis.caseSnapshotDate}</span><span>External Research run: {synthesis.externalResearchRunId || 'None'}</span><span>Input fingerprint: {synthesis.inputFingerprint}</span></details>
    </div>}
  </section>;
}
