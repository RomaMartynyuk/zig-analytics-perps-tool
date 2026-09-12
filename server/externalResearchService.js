import { isIP } from 'node:net';
import { getSql } from './db.js';
import { getConfiguredProtocols } from './protocolRegistry.js';
import { getResearchCaseDetail } from './researchCaseDetailService.js';

export const EXTERNAL_RESEARCH_VERSION = 'v2';
export const RESEARCH_WINDOWS = new Set(['default', '7d', '30d']);
export const EXTERNAL_RESEARCH_LIMITS = Object.freeze({ maxQueriesPerRun: 7, maxResultsPerQuery: 5, maxPageFetches: 0, maxFinalFindings: 7, requestTimeoutMs: 8_000, maxRetries: 1 });

export const EXTERNAL_RESEARCH_TOPICS = Object.freeze({
  turnover_structure: ['trading competition', 'points', 'incentives', 'fees', 'new markets', 'market maker program', 'product update', 'trading API update', 'integration'],
  oi_heavy_structure: ['liquidity campaign', 'leverage update', 'margin update', 'new collateral', 'institutional integration', 'market maker program', 'incentives', 'new markets', 'product update'],
  market_share: ['product update', 'new markets', 'integration', 'trading competition', 'incentives', 'fees', 'points', 'outage', 'distribution partnership'],
  growth: ['liquidity incentives', 'deposit campaign', 'new collateral', 'product update', 'new markets', 'partnership', 'institutional integration', 'ecosystem program', 'points'],
  leadership: ['infrastructure update', 'ecosystem integration', 'new markets', 'product update', 'distribution partnership', 'institutional integration', 'liquidity program'],
  generic: ['announcement', 'product update', 'integration', 'new markets', 'incentives', 'fees'],
});

export const SOURCE_TYPES = Object.freeze({ OFFICIAL_PROTOCOL: 'OFFICIAL_PROTOCOL', OFFICIAL_PARTNER: 'OFFICIAL_PARTNER', GOVERNANCE: 'GOVERNANCE', MEDIA: 'MEDIA', COMMUNITY: 'COMMUNITY', OTHER: 'OTHER' });

const CATEGORY_PATTERNS = [
  ['OUTAGE_INCIDENT', /outage|incident|downtime|maintenance|exploit|disruption/i],
  ['TRADING_CAMPAIGN', /trading competition|trading campaign|trading contest|volume campaign/i],
  ['POINTS_UPDATE', /points? program|points? update|points? multiplier/i],
  ['FEE_CHANGE', /fee change|fee update|fee promotion|fee discount|rebate/i],
  ['LIQUIDITY_PROGRAM', /liquidity program|liquidity campaign|market maker|market-making/i],
  ['NEW_MARKET', /new markets?|new listings?|lists? .*perp|market expansion/i],
  ['INTEGRATION', /integration|integrates|integrated/i],
  ['PARTNERSHIP', /partnership|partners? with|distribution partnership/i],
  ['TOKEN_EVENT', /token launch|token generation|tge|airdrop/i],
  ['INFRASTRUCTURE_UPDATE', /infrastructure|mainnet|testnet|chain upgrade/i],
  ['INCENTIVE_PROGRAM', /incentive|rewards? program|deposit campaign|ecosystem program/i],
  ['PRODUCT_UPDATE', /product update|product launch|release|new feature|api update|v\d/i],
];

const TOPIC_PATTERNS = {
  'trading competition': /trading competition|trading campaign|campaign|contest|volume campaign|rebate/i,
  points: /points?|multiplier|season/i,
  incentives: /incentive|reward|airdrop|points?|campaign/i,
  fees: /fees?|rebate|discount/i,
  'new markets': /new markets?|listing|perpetual|perps?|stock|commodit|forex/i,
  'market maker program': /market maker|market-making|liquidity provider/i,
  'product update': /product|update|launch|release|feature|v\d/i,
  'trading API update': /api|sdk|developer|trading interface/i,
  integration: /integrat/i,
  'liquidity campaign': /liquidity|market maker|deposit campaign/i,
  'leverage update': /leverage/i,
  'margin update': /margin/i,
  'new collateral': /collateral/i,
  'institutional integration': /institution|integrat|custody/i,
  'liquidity incentives': /liquidity|incentive|reward/i,
  'deposit campaign': /deposit|liquidity campaign/i,
  partnership: /partner/i,
  'ecosystem program': /ecosystem|program|grant/i,
  'infrastructure update': /infrastructure|mainnet|testnet|upgrade/i,
  'ecosystem integration': /ecosystem|integrat/i,
  'distribution partnership': /distribution|partner/i,
  'liquidity program': /liquidity|market maker/i,
  outage: /outage|incident|downtime|maintenance/i,
  announcement: /announce|launch|update|release/i,
};

const SOURCE_QUALITY = { [SOURCE_TYPES.OFFICIAL_PROTOCOL]: 1, [SOURCE_TYPES.OFFICIAL_PARTNER]: 0.88, [SOURCE_TYPES.GOVERNANCE]: 0.82, [SOURCE_TYPES.MEDIA]: 0.7, [SOURCE_TYPES.OTHER]: 0.42, [SOURCE_TYPES.COMMUNITY]: 0.28 };
const MEDIA_DOMAINS = ['coindesk.com', 'theblock.co', 'decrypt.co', 'blockworks.co', 'dlnews.com', 'cointelegraph.com', 'reuters.com', 'bloomberg.com'];
const COMMUNITY_DOMAINS = ['reddit.com', 'medium.com', 'mirror.xyz'];
const CAUSAL_LANGUAGE = /\b(caused|caused the increase|because of|explains the spike|resulted in)\b/i;

function canonicalDate(value) { const result = String(value || '').slice(0, 10); return /^\d{4}-\d{2}-\d{2}$/.test(result) && !Number.isNaN(Date.parse(`${result}T00:00:00.000Z`)) ? result : null; }
function addDays(date, days) { const key = canonicalDate(date); if (!key) throw new Error('Invalid canonical snapshot date'); const value = new Date(`${key}T00:00:00.000Z`); value.setUTCDate(value.getUTCDate() + days); return value.toISOString().slice(0, 10); }
function signedDayDistance(from, to) { const left = canonicalDate(from); const right = canonicalDate(to); if (!left || !right) return null; return Math.round((Date.parse(`${left}T00:00:00.000Z`) - Date.parse(`${right}T00:00:00.000Z`)) / 86_400_000); }

function hostIsPrivate(hostname) {
  const host = String(hostname || '').toLowerCase().replace(/^\[|\]$/g, '');
  if (!host || host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local')) return true;
  if (isIP(host) === 4) { const [a, b] = host.split('.').map(Number); return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168); }
  if (isIP(host) === 6) return host === '::1' || host === '::' || /^f[cd]/i.test(host) || /^fe[89ab]/i.test(host);
  return false;
}

export function safeExternalUrl(value) { try { const url = new URL(value); if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || hostIsPrivate(url.hostname)) return null; return url; } catch { return null; } }
function canonicalUrl(value) { const url = safeExternalUrl(value); if (!url) return null; ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content', 'ref'].forEach((key) => url.searchParams.delete(key)); url.hash = ''; return url.toString(); }
function stripText(value) { return String(value || '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim(); }
function escapeRegExp(value) { return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
function hostname(value) { return safeExternalUrl(value)?.hostname?.replace(/^www\./, '').toLowerCase() || ''; }
function domainMatches(host, domain) { return Boolean(host && domain && (host === domain || host.endsWith(`.${domain}`))); }
function monthWords(from, to) { return [...new Set([from, to].map((value) => new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', month: 'long', year: 'numeric' }).format(new Date(`${value}T00:00:00.000Z`))))].join(' '); }
function familyGroup(family) {
  const value = String(family || '').toLowerCase();
  if (value.includes('market_share')) return 'market_share';
  if (value.includes('growth')) return 'growth';
  if (value.includes('leadership')) return 'leadership';
  if (value.includes('oi_heavy')) return 'oi_heavy_structure';
  if (value.includes('turnover')) return 'turnover_structure';
  return EXTERNAL_RESEARCH_TOPICS[value] ? value : 'generic';
}
function topicsForFamily(family) { return EXTERNAL_RESEARCH_TOPICS[familyGroup(family)]; }

export function researchWindow(snapshotDate, period = 'current', requestedWindow = 'default') {
  const key = requestedWindow || 'default';
  if (!RESEARCH_WINDOWS.has(key)) throw new Error('Invalid external research window');
  const defaultLookback = ({ current: 7, '7d': 14, '30d': 35, '90d': 100 })[String(period || '').toLowerCase()] || 7;
  const lookbackDays = key === 'default' ? defaultLookback : key === '30d' ? 30 : 7;
  return { key, from: addDays(snapshotDate, -lookbackDays), to: addDays(snapshotDate, 1), lookbackDays };
}

function officialDomains(metadata = {}) { return [...new Set([metadata.website, metadata.docs, metadata.docsUrl].map(hostname).filter(Boolean))]; }

export function generateExternalQueries(context, metadata = {}) {
  const topics = topicsForFamily(context.case.family).slice(0, 6); const month = monthWords(context.window.from, context.window.to); const domains = officialDomains(metadata);
  const queries = topics.map((topic, index) => ({ topic, query: `"${context.protocol.name}" ${topic} ${month}`, scope: index === 0 && domains.length ? 'official' : 'web', includeDomains: index === 0 && domains.length ? domains : [] }));
  if (['market_share', 'leadership'].includes(familyGroup(context.case.family)) && context.competitors?.length) {
    const peer = context.competitors[0]; queries.push({ topic: 'competitor event', query: `"${peer.name}" outage incident product update ${month}`, scope: 'competitor', competitorSlug: peer.slug, includeDomains: [] });
  }
  return queries.slice(0, EXTERNAL_RESEARCH_LIMITS.maxQueriesPerRun);
}

function sleep(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }
async function providerRequest(fetchImpl, url, options) {
  for (let attempt = 0; attempt <= EXTERNAL_RESEARCH_LIMITS.maxRetries; attempt += 1) {
    const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), EXTERNAL_RESEARCH_LIMITS.requestTimeoutMs);
    try {
      const response = await fetchImpl(url, { ...options, signal: controller.signal });
      if (response.ok || attempt === EXTERNAL_RESEARCH_LIMITS.maxRetries || (response.status !== 429 && response.status < 500)) return response;
      const retryAfter = Number(response.headers.get('retry-after')); await sleep(Number.isFinite(retryAfter) ? Math.min(retryAfter * 1000, 2_000) : 250);
    } finally { clearTimeout(timer); }
  }
  throw new Error('External research request failed');
}

export function createExternalResearchProvider({ fetchImpl = fetch, tavilyKey = process.env.TAVILY_API_KEY } = {}) {
  if (!tavilyKey) return { name: 'unconfigured', configured: false, async search() { throw new Error('TAVILY_API_KEY is not configured'); } };
  return {
    name: 'tavily', configured: true,
    async search(query, options = {}) {
      const response = await providerRequest(fetchImpl, 'https://api.tavily.com/search', {
        method: 'POST', headers: { Authorization: `Bearer ${tavilyKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ query, topic: 'news', search_depth: 'basic', max_results: Math.min(options.limit || EXTERNAL_RESEARCH_LIMITS.maxResultsPerQuery, EXTERNAL_RESEARCH_LIMITS.maxResultsPerQuery), start_date: options.from, end_date: options.to, include_domains: options.includeDomains?.length ? options.includeDomains : undefined, include_answer: false, include_raw_content: false }),
      });
      if (!response.ok) throw new Error(`Tavily search failed (${response.status})`);
      const body = await response.json();
      return (body.results || []).map((result) => ({ title: stripText(result.title), url: result.url, publishedAt: result.published_date || result.publishedDate || null, summary: stripText(result.content), sourceName: hostname(result.url) || 'Web source', providerScore: Number.isFinite(Number(result.score)) ? Number(result.score) : null }));
    },
  };
}

export function externalResearchRunStatus(succeededQueries, failedQueries) {
  if (succeededQueries === 0) return 'FAILED';
  return failedQueries > 0 ? 'PARTIAL' : 'COMPLETED';
}

export async function executeExternalResearchPlan({ queryRows, provider, context, metadata = {} }) {
  let raw = []; const partialErrors = []; let succeededQueries = 0;
  if (provider.configured === false) partialErrors.push({ query: null, error: 'TAVILY_API_KEY is not configured' });
  else {
    const settled = await Promise.allSettled(queryRows.map((item) => provider.search(item.query, { from: context.window.from, to: context.window.to, limit: EXTERNAL_RESEARCH_LIMITS.maxResultsPerQuery, includeDomains: item.includeDomains })));
    settled.forEach((result, index) => {
      if (result.status === 'fulfilled') {
        succeededQueries += 1;
        raw.push(...result.value.map((candidate) => ({ ...candidate, topic: queryRows[index].topic, scope: queryRows[index].scope })));
      } else partialErrors.push({ query: queryRows[index].query, error: String(result.reason?.message || result.reason) });
    });
  }
  const normalized = normalizeExternalResults(raw, context, metadata);
  return { raw, partialErrors, succeededQueries, status: externalResearchRunStatus(succeededQueries, partialErrors.length), ...normalized };
}

export function classifyExternalSource(result, metadata = {}) {
  const url = safeExternalUrl(result.url); const host = hostname(result.sourceUrl || result.url); const official = officialDomains(metadata);
  const partners = (metadata.partners || []).map(hostname).filter(Boolean); const governance = (metadata.governance || []).map(hostname).filter(Boolean);
  if (governance.some((domain) => domainMatches(host, domain))) return SOURCE_TYPES.GOVERNANCE;
  if (official.some((domain) => domainMatches(host, domain))) return SOURCE_TYPES.OFFICIAL_PROTOCOL;
  const xHandle = String(metadata.xHandle || metadata.x || '').replace(/^https?:\/\/(?:www\.)?(?:x\.com|twitter\.com)\//i, '').replace(/^@/, '').split(/[/?#]/)[0].toLowerCase();
  if (xHandle && ['x.com', 'twitter.com'].includes(url?.hostname?.replace(/^www\./, '')) && url.pathname.toLowerCase().startsWith(`/${xHandle}`)) return SOURCE_TYPES.OFFICIAL_PROTOCOL;
  if (partners.some((domain) => domainMatches(host, domain))) return SOURCE_TYPES.OFFICIAL_PARTNER;
  if (MEDIA_DOMAINS.some((domain) => domainMatches(host, domain))) return SOURCE_TYPES.MEDIA;
  if (COMMUNITY_DOMAINS.some((domain) => domainMatches(host, domain)) || ['x.com', 'twitter.com'].includes(host)) return SOURCE_TYPES.COMMUNITY;
  return SOURCE_TYPES.OTHER;
}

function confidenceFor(sourceType) { if (sourceType === SOURCE_TYPES.OFFICIAL_PROTOCOL) return 'HIGH'; if ([SOURCE_TYPES.OFFICIAL_PARTNER, SOURCE_TYPES.GOVERNANCE, SOURCE_TYPES.MEDIA].includes(sourceType)) return 'MEDIUM'; return 'LOW'; }
function temporalScore(distance) { if (distance == null) return 0.35; const absolute = Math.abs(distance); return absolute <= 1 ? 1 : absolute <= 3 ? 0.88 : absolute <= 7 ? 0.7 : absolute <= 30 ? 0.45 : 0.12; }
function specificityScore(text) { const concreteVerb = /announc|launch|introduc|added|listed|integrat|partner|updat|open|begin|end|suspend|outage|incident/i.test(text); const concreteDetail = /\b\d+(?:\.\d+)?%?\b|\b(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\b/i.test(text); return concreteVerb && concreteDetail ? 1 : concreteVerb ? 0.78 : 0.38; }
function categoryFor(text, topic) { return CATEGORY_PATTERNS.find(([, pattern]) => pattern.test(text))?.[0] || ({ outage: 'OUTAGE_INCIDENT', points: 'POINTS_UPDATE', fees: 'FEE_CHANGE', integration: 'INTEGRATION', partnership: 'PARTNERSHIP' })[topic] || 'OTHER'; }
function titleTokens(value) { return new Set(stripText(value).toLowerCase().replace(/[^a-z0-9]+/g, ' ').split(' ').filter((word) => word.length > 2)); }
function titleSimilarity(left, right) { const a = titleTokens(left); const b = titleTokens(right); if (!a.size || !b.size) return 0; const intersection = [...a].filter((token) => b.has(token)).length; return intersection / (a.size + b.size - intersection); }
function findingIsBetter(candidate, current) { return (SOURCE_QUALITY[candidate.sourceType] || 0) > (SOURCE_QUALITY[current.sourceType] || 0) || ((SOURCE_QUALITY[candidate.sourceType] || 0) === (SOURCE_QUALITY[current.sourceType] || 0) && candidate.relevanceScore > current.relevanceScore); }
function possibleRelevance(topic, distance) { const timing = distance == null ? 'The publication date is unavailable' : distance === 0 ? 'It was published on the canonical snapshot date' : `It was published ${Math.abs(distance)} day${Math.abs(distance) === 1 ? '' : 's'} ${distance < 0 ? 'before' : 'after'} the canonical snapshot`; return `${topic[0].toUpperCase()}${topic.slice(1)} matches this Research Case topic. ${timing}. It provides context worth investigating; it does not establish causation.`; }
function duplicateEvent(left, right) { if (left.url === right.url) return true; if (left.category !== right.category) return false; const dateDistance = left.publishedAt && right.publishedAt ? Math.abs(signedDayDistance(left.publishedAt, right.publishedAt)) : 0; return dateDistance <= 3 && titleSimilarity(left.title, right.title) >= 0.62; }

export function normalizeExternalResults(rawResults, context, metadata = {}) {
  const findings = []; const suppressed = [];
  for (const raw of rawResults) {
    const url = canonicalUrl(raw.url); const title = stripText(raw.title); const summary = stripText(raw.summary).slice(0, 420);
    const parsedPublished = raw.publishedAt && !Number.isNaN(Date.parse(raw.publishedAt)) ? new Date(raw.publishedAt).toISOString() : null;
    if (!url || !title) { suppressed.push({ title: title || 'Untitled', url: raw.url || null, reason: 'malformed_result' }); continue; }
    const publishedKey = canonicalDate(parsedPublished);
    if (publishedKey && (publishedKey < context.window.from || publishedKey > context.window.to)) { suppressed.push({ title, url, reason: 'outside_research_window' }); continue; }
    const text = `${title} ${summary}`; const aliases = [context.protocol.name, context.protocol.slug, ...(metadata.identityTerms || [])].filter(Boolean);
    const protocolMatch = aliases.some((term) => new RegExp(`(^|[^a-z0-9])${escapeRegExp(term)}(?=$|[^a-z0-9])`, 'i').test(text));
    if (!protocolMatch && raw.scope !== 'competitor') { suppressed.push({ title, url, reason: 'protocol_mismatch' }); continue; }
    const topicPattern = TOPIC_PATTERNS[raw.topic] || (raw.topic === 'competitor event' ? /outage|incident|product|update/i : /announce|launch|update|release/i);
    if (!topicPattern.test(text)) { suppressed.push({ title, url, reason: 'topic_mismatch' }); continue; }
    const sourceType = classifyExternalSource(raw, metadata); const distance = parsedPublished ? signedDayDistance(parsedPublished, context.case.snapshotDate) : null; const specificity = specificityScore(text);
    const relevanceScore = Math.round(((SOURCE_QUALITY[sourceType] || 0.3) * 0.34 + temporalScore(distance) * 0.26 + 1 * 0.2 + 1 * 0.12 + specificity * 0.08) * 100);
    const cappedScore = [SOURCE_TYPES.OTHER, SOURCE_TYPES.COMMUNITY].includes(sourceType) ? Math.min(62, relevanceScore) : relevanceScore;
    if (cappedScore < 52) { suppressed.push({ title, url, reason: 'low_relevance' }); continue; }
    const topic = raw.topic || 'external event'; const sourceName = raw.sourceName || hostname(url) || 'Web source';
    const finding = {
      id: null, category: raw.scope === 'competitor' ? 'COMPETITOR_EVENT' : categoryFor(text, topic), title,
      source: { type: sourceType, name: sourceName, url }, sourceType, sourceName, url,
      publishedAt: parsedPublished, eventDate: null, factualSummary: summary || 'The source title and publication metadata are available at the linked source.', summary: summary || 'The source title and publication metadata are available at the linked source.',
      relevanceScore: cappedScore, relevance: cappedScore, confidence: confidenceFor(sourceType), temporalDistanceDays: distance,
      relevanceReasons: [sourceType === SOURCE_TYPES.OFFICIAL_PROTOCOL ? 'Official protocol source' : `${sourceType.replaceAll('_', ' ').toLowerCase()} source`, distance == null ? 'Publication date unavailable' : `Published ${Math.abs(distance)} day${Math.abs(distance) === 1 ? '' : 's'} from the canonical snapshot`, `Direct match to ${topic} topic`],
      possibleRelevance: possibleRelevance(topic, distance), supportingSources: [], causalClaim: false,
    };
    finding.relevanceExplanation = finding.relevanceReasons;
    if (CAUSAL_LANGUAGE.test(finding.possibleRelevance)) throw new Error('Generated relevance copy contains causal language');
    const duplicateIndex = findings.findIndex((item) => duplicateEvent(item, finding));
    if (duplicateIndex >= 0) {
      const current = findings[duplicateIndex]; const replace = findingIsBetter(finding, current); const primary = replace ? finding : current; const supporting = replace ? current : finding;
      primary.supportingSources = [...(primary.supportingSources || []), ...(supporting.supportingSources || []), { title: supporting.title, url: supporting.url, sourceName: supporting.sourceName, sourceType: supporting.sourceType }];
      findings[duplicateIndex] = primary; suppressed.push({ title: supporting.title, url: supporting.url, reason: 'duplicate_event' });
    } else findings.push(finding);
  }
  findings.sort((left, right) => right.relevanceScore - left.relevanceScore || String(left.title).localeCompare(String(right.title)));
  const selected = findings.slice(0, EXTERNAL_RESEARCH_LIMITS.maxFinalFindings);
  findings.slice(EXTERNAL_RESEARCH_LIMITS.maxFinalFindings).forEach((item) => suppressed.push({ title: item.title, url: item.url, reason: 'result_limit' }));
  return { findings: selected, lowConfidence: selected.filter((item) => item.confidence === 'LOW'), suppressed };
}

function rowToFinding(row) { const metadata = row.metadata_json || {}; return { id: String(row.id), category: row.category, title: row.title, source: { type: row.source_type, name: row.source_name, url: row.url }, sourceType: row.source_type, sourceName: row.source_name, url: row.url, publishedAt: row.published_at ? new Date(row.published_at).toISOString() : null, eventDate: canonicalDate(row.event_date), factualSummary: row.summary, summary: row.summary, possibleRelevance: row.possible_relevance, relevanceScore: Number(row.relevance_score), relevance: Number(row.relevance_score), confidence: row.confidence, temporalDistanceDays: row.temporal_distance_days, supportingSources: row.supporting_sources_json || [], relevanceReasons: metadata.relevanceReasons || [], relevanceExplanation: metadata.relevanceReasons || [], causalClaim: false }; }
function rowToRun(run, findings) { return { id: String(run.id), caseId: run.case_id, provider: run.provider, status: run.status, researchedAt: run.completed_at || run.created_at, researchVersion: run.research_version, researchWindow: { from: canonicalDate(run.window_start), to: canonicalDate(run.window_end), key: run.window_key }, queries: run.queries_json || [], findings, summary: run.summary_json || { totalFindings: findings.length }, error: run.error || null, caseReference: run.case_reference_json || null }; }

export async function getLatestExternalResearch(caseId, sql = getSql(), options = {}) {
  try {
    const values = [caseId]; let where = 'case_id = $1';
    if (options.windowKey) { values.push(options.windowKey); where += ` AND window_key = $${values.length}`; }
    if (options.researchVersion) { values.push(options.researchVersion); where += ` AND research_version = $${values.length}`; }
    if (options.cacheableOnly) where += " AND status IN ('COMPLETED', 'PARTIAL')";
    const runs = await sql.query(`SELECT * FROM external_research_runs WHERE ${where} ORDER BY created_at DESC LIMIT 1`, values);
    if (!runs.length) return null;
    const rows = await sql.query('SELECT * FROM external_research_findings WHERE research_run_id = $1 ORDER BY relevance_score DESC, id ASC', [runs[0].id]);
    return rowToRun(runs[0], rows.map(rowToFinding));
  } catch (error) { if (/does not exist|undefined table|relation|column .* does not exist/i.test(error.message || '')) return null; throw error; }
}

async function persistRun({ context, providerName, status, queryRows, findings, partialErrors, suppressed, rawResultCount }, sql) {
  const summary = { totalFindings: findings.length, highConfidence: findings.filter((item) => item.confidence === 'HIGH').length, officialSources: findings.filter((item) => item.sourceType === SOURCE_TYPES.OFFICIAL_PROTOCOL).length, queryFailures: partialErrors.length, resultCount: rawResultCount, suppressed: suppressed.length };
  const reference = { caseId: context.case.id, headline: context.case.headline, signalFamily: context.case.family, signalType: context.case.signalType, score: context.case.score, severity: context.case.severity, period: context.case.period, protocol: context.protocol, snapshotDate: context.case.snapshotDate };
  const runRows = await sql.query(`INSERT INTO external_research_runs
    (case_id, protocol_id, snapshot_date, window_start, window_end, window_key, research_version, status, provider, queries_json, summary_json, error, completed_at, signal_family, signal_type, case_headline, protocol_slug, protocol_name, query_count, result_count, suppressed_json, case_reference_json)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11::jsonb,$12,NOW(),$13,$14,$15,$16,$17,$18,$19,$20::jsonb,$21::jsonb) RETURNING id`, [context.case.id, context.protocol.id, context.case.snapshotDate, context.window.from, context.window.to, context.window.key, EXTERNAL_RESEARCH_VERSION, status, providerName, JSON.stringify(queryRows), JSON.stringify(summary), partialErrors.length ? partialErrors.map((item) => item.error).join('; ').slice(0, 1800) : null, context.case.family, context.case.signalType, context.case.headline, context.protocol.slug, context.protocol.name, queryRows.length, rawResultCount, JSON.stringify(suppressed), JSON.stringify(reference)]);
  if (findings.length) {
    const records = findings.map((finding) => ({ category: finding.category, title: finding.title, source_type: finding.sourceType, source_name: finding.sourceName, url: finding.url, published_at: finding.publishedAt, event_date: finding.eventDate, summary: finding.factualSummary, possible_relevance: finding.possibleRelevance, relevance_score: finding.relevanceScore, confidence: finding.confidence, temporal_distance_days: finding.temporalDistanceDays, supporting_sources_json: finding.supportingSources, metadata_json: { causalClaim: false, relevanceReasons: finding.relevanceReasons } }));
    await sql.query(`INSERT INTO external_research_findings
      (research_run_id, category, title, source_type, source_name, url, published_at, event_date, summary, possible_relevance, relevance_score, confidence, temporal_distance_days, supporting_sources_json, metadata_json)
      SELECT $1, x.category, x.title, x.source_type, x.source_name, x.url, x.published_at, x.event_date, x.summary, x.possible_relevance, x.relevance_score, x.confidence, x.temporal_distance_days, x.supporting_sources_json, x.metadata_json
      FROM jsonb_to_recordset($2::jsonb) AS x(category text, title text, source_type text, source_name text, url text, published_at timestamptz, event_date date, summary text, possible_relevance text, relevance_score numeric, confidence text, temporal_distance_days integer, supporting_sources_json jsonb, metadata_json jsonb)`, [runRows[0].id, JSON.stringify(records)]);
  }
  return getLatestExternalResearch(context.case.id, sql, { windowKey: context.window.key, researchVersion: EXTERNAL_RESEARCH_VERSION });
}

function buildContext(caseDetail, requestedWindow) {
  const configured = getConfiguredProtocols().find((item) => item.slug === caseDetail.protocol.slug) || {};
  const context = {
    protocol: { ...caseDetail.protocol, website: configured.externalResearch?.website || null, docsUrl: configured.externalResearch?.docs || configured.externalResearch?.docsUrl || null, xHandle: configured.externalResearch?.xHandle || configured.externalResearch?.x || null },
    case: { id: caseDetail.case.id, headline: caseDetail.case.headline, family: caseDetail.case.family, signalType: caseDetail.case.primarySignal?.type || null, primarySignal: caseDetail.case.primarySignal, relatedSignals: caseDetail.relatedSignals, snapshotDate: caseDetail.snapshot.date, period: caseDetail.case.period, score: caseDetail.case.score, severity: caseDetail.case.severity },
    currentMetrics: caseDetail.metrics, history: caseDetail.history, competitors: caseDetail.researchPeers || [],
  };
  context.window = researchWindow(context.case.snapshotDate, context.case.period, requestedWindow);
  return { context, metadata: configured.externalResearch || {} };
}

export async function runExternalResearch({ caseId, window: requestedWindow = 'default', force = false, provider, sql = getSql(), persist = true } = {}) {
  if (typeof caseId !== 'string' || !/^research:\d{4}-\d{2}-\d{2}:[a-z0-9._-]+:[a-z0-9_-]+$/i.test(caseId)) throw new Error('Invalid research case id');
  if (!RESEARCH_WINDOWS.has(requestedWindow)) throw new Error('Invalid external research window');
  const caseDetail = await getResearchCaseDetail(caseId, sql); if (!caseDetail) throw new Error('Research case not found for the current canonical snapshot');
  const { context, metadata } = buildContext(caseDetail, requestedWindow);
  if (persist && !force) { const cached = await getLatestExternalResearch(caseId, sql, { windowKey: context.window.key, researchVersion: EXTERNAL_RESEARCH_VERSION, cacheableOnly: true }); if (cached) return { ...cached, cacheHit: true }; }
  const queryRows = generateExternalQueries(context, metadata); const activeProvider = provider || createExternalResearchProvider();
  const baseResult = { caseId, provider: activeProvider.name, researchedAt: new Date().toISOString(), researchVersion: EXTERNAL_RESEARCH_VERSION, researchWindow: context.window, queries: queryRows, cacheHit: false };
  const execution = await executeExternalResearchPlan({ queryRows, provider: activeProvider, context, metadata });
  const { raw, partialErrors, status } = execution; const normalized = execution;
  const result = { ...baseResult, status, findings: normalized.findings, summary: { totalFindings: normalized.findings.length, highConfidence: normalized.findings.filter((item) => item.confidence === 'HIGH').length, officialSources: normalized.findings.filter((item) => item.sourceType === SOURCE_TYPES.OFFICIAL_PROTOCOL).length, queryFailures: partialErrors.length, resultCount: raw.length, suppressed: normalized.suppressed.length }, partialErrors, suppressed: normalized.suppressed, error: status === 'FAILED' ? (activeProvider.configured === false ? 'External research provider is not configured.' : 'The external research provider did not complete any query.') : null };
  console.info('External research run', { caseId, protocolSlug: context.protocol.slug, provider: activeProvider.name, queryCount: queryRows.length, rawResultCount: raw.length, candidateCount: raw.length - normalized.suppressed.length, findingCount: normalized.findings.length, cacheHit: false, failedQueries: partialErrors.length, status });
  if (!persist) return result;
  try { return await persistRun({ context, providerName: activeProvider.name, status, queryRows, findings: normalized.findings, partialErrors, suppressed: normalized.suppressed, rawResultCount: raw.length }, sql); }
  catch (error) { if (/does not exist|undefined table|relation|column .* does not exist/i.test(error.message || '')) throw new Error('External research storage is not ready. Run database migrations.'); throw error; }
}
