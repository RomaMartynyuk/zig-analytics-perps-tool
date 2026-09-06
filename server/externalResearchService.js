import { readFile } from 'node:fs/promises';
import { getSql } from './db.js';
import { getResearchCaseDetail } from './researchCaseDetailService.js';

export const EXTERNAL_RESEARCH_VERSION = 'v1';
export const RESEARCH_WINDOWS = new Set(['7d', '30d']);
const MAX_QUERIES = 6;
const MAX_RESULTS_PER_QUERY = 5;
const CATEGORY_BY_TOPIC = { 'new markets': 'NEW_MARKET', 'trading competition': 'TRADING_CAMPAIGN', points: 'POINTS_UPDATE', incentives: 'INCENTIVE_PROGRAM', fees: 'FEE_CHANGE', 'product update': 'PRODUCT_UPDATE', integration: 'INTEGRATION', partnership: 'PARTNERSHIP', liquidity: 'LIQUIDITY_PROGRAM', outage: 'OUTAGE_INCIDENT', announcement: 'OTHER' };
const TOPIC_KEYWORDS = { 'new markets': /market|listing|perp|stock|commodit|forex|v2/i, 'trading competition': /competition|campaign|contest|rebate|trading/i, points: /point|incentive|reward/i, incentives: /incentive|reward|campaign|airdrop|point|token/i, fees: /fee|rebate|discount/i, 'product update': /update|launch|release|v2|product|feature/i, integration: /integrat|partner/i, partnership: /partner/i, liquidity: /liquidity|market maker|mm program/i, outage: /outage|incident|downtime|maintenance/i, announcement: /announce|launch|update|release/i };
const FAMILY_TOPICS = {
  turnover_structure: ['new markets', 'trading competition', 'points', 'incentives', 'fees', 'product update'],
  oi_heavy_structure: ['liquidity', 'incentives', 'product update', 'fees', 'integration'],
  market_share: ['product update', 'new markets', 'incentives', 'integration', 'trading competition'],
  growth: ['incentives', 'liquidity', 'product update', 'integration', 'partnership'],
  leadership: ['product update', 'integration', 'partnership', 'new markets', 'infrastructure'],
};
const GENERIC_TOPICS = ['product update', 'announcement', 'integration', 'incentives'];

function canonicalDate(value) { return String(value || '').slice(0, 10); }
function addDays(date, days) { const value = new Date(`${canonicalDate(date)}T00:00:00.000Z`); value.setUTCDate(value.getUTCDate() + days); return value.toISOString().slice(0, 10); }
function dayDistance(from, to) { return Math.abs((Date.parse(`${canonicalDate(from)}T00:00:00Z`) - Date.parse(`${canonicalDate(to)}T00:00:00Z`)) / 86400000); }
function validHttpUrl(value) { try { const url = new URL(value); return ['http:', 'https:'].includes(url.protocol) ? url : null; } catch { return null; } }
function canonicalUrl(value) { const url = validHttpUrl(value); if (!url) return null; ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content', 'ref'].forEach((key) => url.searchParams.delete(key)); url.hash = ''; return url.toString(); }
function stripText(value) { return String(value || '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim(); }
function xmlText(value, tag) { const match = value.match(new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${tag}>`, 'i')); return stripText(match?.[1]?.replace(/^<!\[CDATA\[|\]\]>$/g, '') || ''); }
function monthWords(from, to) { return [...new Set([from, to].map((date) => new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', month: 'long', year: 'numeric' }).format(new Date(`${date}T00:00:00Z`))))].join(' '); }
function topicForFamily(family) { return FAMILY_TOPICS[String(family || '').toLowerCase()] || GENERIC_TOPICS; }

export function researchWindow(snapshotDate, period = 'current', requestedWindow) {
  const window = RESEARCH_WINDOWS.has(requestedWindow) ? requestedWindow : (period === '30d' || period === '90d' ? '30d' : '7d');
  return { key: window, from: addDays(snapshotDate, window === '30d' ? -30 : -7), to: addDays(snapshotDate, 1) };
}

export function generateExternalQueries(context) {
  const topics = topicForFamily(context.case.family).slice(0, MAX_QUERIES);
  const month = monthWords(context.window.from, context.window.to);
  return topics.map((topic) => ({ topic, category: CATEGORY_BY_TOPIC[topic] || 'OTHER', query: `${context.protocol.name} ${topic} ${month}` }));
}

async function loadRegistryMetadata(protocol) {
  try {
    const source = await readFile(new URL('../src/data/projects.json', import.meta.url), 'utf8');
    const item = JSON.parse(source).find((project) => project.name.toLowerCase() === protocol.name.toLowerCase());
    return item?.external_research || {};
  } catch { return {}; }
}

async function fetchWithTimeout(url, options = {}, timeoutMs = 8000) {
  const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), timeoutMs);
  try { return await fetch(url, { ...options, signal: controller.signal, headers: { Accept: 'application/json, application/rss+xml, application/xml;q=0.9', ...(options.headers || {}) } }); }
  finally { clearTimeout(timer); }
}
async function requestWithTimeout(fetchImpl, url, options = {}, timeoutMs = 8000) {
  const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), timeoutMs);
  try { return await fetchImpl(url, { ...options, signal: controller.signal }); }
  finally { clearTimeout(timer); }
}

export function createExternalResearchProvider({ fetchImpl = fetch, tavilyKey = process.env.TAVILY_API_KEY } = {}) {
  if (tavilyKey) return {
    name: 'tavily',
    async search(query) {
      const response = await requestWithTimeout(fetchImpl, 'https://api.tavily.com/search', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ api_key: tavilyKey, query, max_results: MAX_RESULTS_PER_QUERY, search_depth: 'basic', include_answer: false }) });
      if (!response.ok) throw new Error(`Tavily search failed (${response.status})`);
      const body = await response.json();
      return (body.results || []).map((result) => ({ title: stripText(result.title), url: result.url, publishedAt: result.published_date || null, summary: stripText(result.content), sourceName: validHttpUrl(result.url)?.hostname || 'Web source' }));
    },
  };
  return {
    name: 'google_news_rss',
    async search(query) {
      const url = `https://news.google.com/rss/search?q=${encodeURIComponent(query)}&hl=en-US&gl=US&ceid=US:en`;
      const response = await fetchWithTimeout(url, {}, 8000);
      if (!response.ok) throw new Error(`News search failed (${response.status})`);
      const xml = await response.text();
      return [...xml.matchAll(/<item>([\s\S]*?)<\/item>/gi)].slice(0, MAX_RESULTS_PER_QUERY).map((match) => {
        const item = match[1]; const sourceMatch = item.match(/<source(?:\s+url="([^"]+)")?>([\s\S]*?)<\/source>/i);
        return { title: xmlText(item, 'title'), url: xmlText(item, 'link'), publishedAt: xmlText(item, 'pubDate') || null, summary: xmlText(item, 'description'), sourceName: stripText(sourceMatch?.[2]) || 'Google News', sourceUrl: sourceMatch?.[1] || null };
      });
    },
  };
}

function sourceTypeFor(result, metadata) {
  const host = validHttpUrl(result.sourceUrl || result.url)?.hostname?.replace(/^www\./, '') || '';
  const official = [metadata.website, metadata.docs, metadata.x].filter(Boolean).map((value) => validHttpUrl(value)?.hostname?.replace(/^www\./, '')).filter(Boolean);
  const partners = (metadata.partners || []).map((value) => validHttpUrl(value)?.hostname?.replace(/^www\./, '')).filter(Boolean);
  if (official.some((domain) => host === domain || host.endsWith(`.${domain}`))) return 'official';
  if (partners.some((domain) => host === domain || host.endsWith(`.${domain}`))) return 'partner';
  if (/coindesk|theblock|decrypt|blockworks|dlnews|cointelegraph/i.test(host)) return 'secondary';
  return 'other';
}
function confidenceFor(type) { return type === 'official' ? 'HIGH' : type === 'partner' || type === 'secondary' ? 'MEDIUM' : 'LOW'; }
function temporalScore(distance) { return distance <= 1 ? 1 : distance <= 3 ? .85 : distance <= 7 ? .68 : distance <= 30 ? .42 : .08; }
function qualityScore(type) { return ({ official: 1, partner: .86, secondary: .68, other: .42 })[type] || .3; }
function relevanceText(topic, distance) { return `${topic[0].toUpperCase()}${topic.slice(1)} is relevant to this research case; the source was published ${distance === 0 ? 'on the snapshot date' : `${distance} day${distance === 1 ? '' : 's'} from the snapshot`}. This is context to investigate, not a causal conclusion.`; }
function titleKey(value) { return stripText(value).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().split(' ').filter((word) => word.length > 2).slice(0, 12).sort().join(' '); }

export function normalizeExternalResults(rawResults, context, metadata = {}) {
  const unique = new Map(); const suppressed = [];
  for (const raw of rawResults) {
    const url = canonicalUrl(raw.url); const title = stripText(raw.title); const publishedAt = raw.publishedAt && !Number.isNaN(Date.parse(raw.publishedAt)) ? new Date(raw.publishedAt).toISOString() : null;
    if (!url || !title) { suppressed.push({ title: title || 'Untitled', reason: 'malformed_result' }); continue; }
    const distance = publishedAt ? dayDistance(publishedAt, context.case.snapshotDate) : 99;
    if (publishedAt && (canonicalDate(publishedAt) < context.window.from || canonicalDate(publishedAt) > context.window.to)) { suppressed.push({ title, url, reason: 'outside_research_window' }); continue; }
    const searchableText = `${title} ${raw.summary || ''}`;
    const protocolMatch = new RegExp(`(^|[^a-z0-9])${context.protocol.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?=$|[^a-z0-9])`, 'i').test(searchableText);
    const identityMatch = !(metadata.identityTerms || []).length || metadata.identityTerms.some((term) => searchableText.toLowerCase().includes(String(term).toLowerCase()));
    const topicMatch = (TOPIC_KEYWORDS[raw.topic] || /./).test(searchableText);
    if (!protocolMatch || !identityMatch) { suppressed.push({ title, url, reason: identityMatch ? 'protocol_mismatch' : 'ambiguous_protocol_name' }); continue; }
    if (!topicMatch) { suppressed.push({ title, url, reason: 'topic_mismatch' }); continue; }
    const sourceType = sourceTypeFor(raw, metadata);
    const rawRelevance = Math.round((qualityScore(sourceType) * .36 + temporalScore(distance) * .28 + 1 * .22 + 1 * .14) * 100);
    const relevance = sourceType === 'other' ? Math.min(59, rawRelevance) : rawRelevance;
    if (relevance < 45) { suppressed.push({ title, url, reason: 'low_relevance' }); continue; }
    const finding = { category: raw.category || 'OTHER', title, sourceType, sourceName: raw.sourceName || validHttpUrl(url)?.hostname || 'Web source', url, publishedAt, eventDate: null, summary: stripText(raw.summary).slice(0, 420) || 'Source metadata is available at the linked publication.', relevance, temporalDistanceDays: publishedAt ? distance : null, confidence: confidenceFor(sourceType), possibleRelevance: relevanceText(raw.topic || 'This event', distance), supportingSources: [], causalClaim: false, relevanceExplanation: [`${sourceType === 'official' ? 'Official protocol source' : `${sourceType} source`}`, publishedAt ? `Published ${distance} day${distance === 1 ? '' : 's'} from the snapshot` : 'Publication date unavailable', `Matches ${raw.topic || 'the selected'} research topic`] };
    const key = `${titleKey(title)}|${canonicalUrl(url)}`;
    const duplicate = [...unique.values()].find((item) => item.url === url || (titleKey(item.title) && titleKey(item.title) === titleKey(title)));
    if (duplicate) {
      const replace = finding.relevance > duplicate.relevance || (finding.sourceType === 'official' && duplicate.sourceType !== 'official');
      const retained = replace ? finding : duplicate; const extra = replace ? duplicate : finding;
      retained.supportingSources.push({ title: extra.title, url: extra.url, sourceName: extra.sourceName, sourceType: extra.sourceType });
      if (replace) { unique.delete(key); unique.set(`${titleKey(retained.title)}|${retained.url}`, retained); }
      suppressed.push({ title: extra.title, url: extra.url, reason: 'duplicate_event' });
    } else unique.set(key, finding);
  }
  const findings = [...unique.values()].sort((a, b) => b.relevance - a.relevance).slice(0, 7);
  return { findings, lowConfidence: findings.filter((item) => item.confidence === 'LOW'), suppressed };
}

function rowToFinding(row) { return { id: String(row.id), category: row.category, title: row.title, sourceType: row.source_type, sourceName: row.source_name, url: row.url, publishedAt: row.published_at ? new Date(row.published_at).toISOString() : null, eventDate: canonicalDate(row.event_date) || null, summary: row.summary, possibleRelevance: row.possible_relevance, relevance: Number(row.relevance_score), confidence: row.confidence, temporalDistanceDays: row.temporal_distance_days, supportingSources: row.supporting_sources_json || [], ...(row.metadata_json || {}) }; }

export async function getLatestExternalResearch(caseId, sql = getSql()) {
  try {
    const runs = await sql.query(`SELECT * FROM external_research_runs WHERE case_id = $1 AND status IN ('COMPLETED', 'PARTIAL') ORDER BY created_at DESC LIMIT 1`, [caseId]);
    if (!runs.length) return null;
    const run = runs[0]; const rows = await sql.query(`SELECT * FROM external_research_findings WHERE research_run_id = $1 ORDER BY relevance_score DESC, id ASC`, [run.id]);
    return { id: String(run.id), caseId: run.case_id, provider: run.provider, status: run.status, researchedAt: run.completed_at || run.created_at, researchWindow: { from: canonicalDate(run.window_start), to: canonicalDate(run.window_end), key: run.window_key }, queries: run.queries_json || [], findings: rows.map(rowToFinding), summary: run.summary_json || { totalFindings: rows.length }, error: run.error || null };
  } catch (error) {
    if (/does not exist|undefined table|relation/i.test(error.message || '')) return null;
    throw error;
  }
}

async function persistRun({ caseDetail, context, providerName, queryRows, findings, partialErrors, suppressed }, sql) {
  const run = await sql.query(`INSERT INTO external_research_runs (case_id, protocol_id, snapshot_date, window_start, window_end, window_key, research_version, status, provider, queries_json, summary_json, error, completed_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11::jsonb,$12,NOW()) RETURNING id`, [context.case.id, context.protocol.id, context.case.snapshotDate, context.window.from, context.window.to, context.window.key, EXTERNAL_RESEARCH_VERSION, partialErrors.length ? 'PARTIAL' : 'COMPLETED', providerName, JSON.stringify(queryRows), JSON.stringify({ totalFindings: findings.length, highConfidence: findings.filter((item) => item.confidence === 'HIGH').length, officialSources: findings.filter((item) => item.sourceType === 'official').length, queryFailures: partialErrors.length, suppressed: suppressed.length }), partialErrors.length ? partialErrors.map((item) => item.error).join('; ').slice(0, 1800) : null]);
  for (const finding of findings) await sql.query(`INSERT INTO external_research_findings (research_run_id, category, title, source_type, source_name, url, published_at, event_date, summary, possible_relevance, relevance_score, confidence, temporal_distance_days, supporting_sources_json, metadata_json) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14::jsonb,$15::jsonb)`, [run[0].id, finding.category, finding.title, finding.sourceType, finding.sourceName, finding.url, finding.publishedAt, finding.eventDate, finding.summary, finding.possibleRelevance, finding.relevance, finding.confidence, finding.temporalDistanceDays, JSON.stringify(finding.supportingSources), JSON.stringify({ causalClaim: false, relevanceExplanation: finding.relevanceExplanation })]);
  return getLatestExternalResearch(context.case.id, sql);
}

export async function runExternalResearch({ caseId, window: requestedWindow, force = false, provider, sql = getSql(), persist = true } = {}) {
  if (typeof caseId !== 'string' || !caseId.startsWith('research:')) throw new Error('Invalid research case id');
  if (requestedWindow != null && !RESEARCH_WINDOWS.has(requestedWindow)) throw new Error('Invalid external research window');
  const caseDetail = await getResearchCaseDetail(caseId, sql);
  if (!caseDetail) throw new Error('Research case not found for the current canonical snapshot');
  const context = { protocol: caseDetail.protocol, case: { id: caseDetail.case.id, headline: caseDetail.case.headline, family: caseDetail.case.family, primarySignal: caseDetail.case.primarySignal, relatedSignals: caseDetail.relatedSignals, snapshotDate: caseDetail.snapshot.date, period: caseDetail.case.period, score: caseDetail.case.score, severity: caseDetail.case.severity }, metrics: caseDetail.metrics, historicalContext: caseDetail.history };
  context.window = researchWindow(context.case.snapshotDate, context.case.period, requestedWindow);
  if (persist && !force) { const cached = await getLatestExternalResearch(caseId, sql); if (cached && cached.researchWindow.key === context.window.key) return { ...cached, cacheHit: true }; }
  const queryRows = generateExternalQueries(context); const metadata = await loadRegistryMetadata(context.protocol); const activeProvider = provider || createExternalResearchProvider();
  const searches = queryRows.map((item) => activeProvider
    .search(item.query, { from: context.window.from, to: context.window.to, limit: MAX_RESULTS_PER_QUERY })
    .then((results) => results.map((result) => ({ ...result, topic: item.topic, category: item.category }))));
  const settled = await Promise.allSettled(searches);
  const raw = []; const partialErrors = [];
  settled.forEach((result, index) => { if (result.status === 'fulfilled') raw.push(...result.value); else partialErrors.push({ query: queryRows[index].query, error: String(result.reason?.message || result.reason) }); });
  const normalized = normalizeExternalResults(raw, context, metadata);
  const result = { caseId, provider: activeProvider.name, status: partialErrors.length ? 'PARTIAL' : 'COMPLETED', researchedAt: new Date().toISOString(), researchWindow: context.window, queries: queryRows, findings: normalized.findings, summary: { totalFindings: normalized.findings.length, highConfidence: normalized.findings.filter((item) => item.confidence === 'HIGH').length, officialSources: normalized.findings.filter((item) => item.sourceType === 'official').length, queryFailures: partialErrors.length, suppressed: normalized.suppressed.length }, partialErrors, suppressed: normalized.suppressed, cacheHit: false };
  if (!persist) return result;
  try { return await persistRun({ caseDetail, context, providerName: activeProvider.name, queryRows, findings: normalized.findings, partialErrors, suppressed: normalized.suppressed }, sql); }
  catch (error) { if (/does not exist|undefined table|relation/i.test(error.message || '')) throw new Error('External research storage is not ready. Run database migrations.'); throw error; }
}
