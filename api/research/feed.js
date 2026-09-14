import { getDailyResearchFeed, updateResearchCaseStatus } from '../../server/researchFeedService.js';
import { getResearchCaseDetail } from '../../server/researchCaseDetailService.js';
import { getLatestExternalResearch, runExternalResearch } from '../../server/externalResearchService.js';
import { validResearchCaseId } from '../../server/researchCasePersistence.js';
import { buildAndPersistResearchSynthesis, getResearchSynthesisState } from '../../server/researchSynthesisService.js';
import { getSignalHistory } from '../../server/signalHistoryService.js';
import { getSignalLifecycle } from '../../server/signalLifecycleService.js';
import { getResearchWatchlist } from '../../server/researchWatchlistService.js';
import { getResearchCaseTimeline } from '../../server/researchTimelineService.js';

function body(req) {
  if (!req.body) return {};
  if (typeof req.body === 'string') { try { return JSON.parse(req.body); } catch { return {}; } }
  return req.body;
}

export default async function handler(req, res) {
  try {
    if (req.method === 'GET') {
      if (req.query.action === 'watchlist') return res.status(200).json(await getResearchWatchlist());
      if (req.query.action === 'timeline') {
        if (!validResearchCaseId(req.query.caseId)) return res.status(400).json({ error: 'Invalid research case id', reason: 'INVALID_CASE_ID' });
        try { return res.status(200).json(await getResearchCaseTimeline({ caseId: req.query.caseId })); }
        catch (error) { if (/requires a persisted Research Case/i.test(error.message)) return res.status(410).json({ unavailable: true, reason: 'HISTORICAL_CASE_UNAVAILABLE', caseId: req.query.caseId }); throw error; }
      }
      if (req.query.action === 'signal-history') return res.status(200).json(await getSignalHistory({ caseId: req.query.caseId, period: req.query.period || '7d' }));
      if (req.query.action === 'signal-lifecycle') return res.status(200).json(await getSignalLifecycle({ caseId: req.query.caseId }));
      if (req.query.caseId) {
        if (!validResearchCaseId(req.query.caseId)) return res.status(400).json({ error: 'Invalid research case id', reason: 'INVALID_CASE_ID' });
        const detail = await getResearchCaseDetail(req.query.caseId);
        if (detail?.unavailable) return res.status(410).json(detail);
        const [externalResearch, synthesis] = await Promise.all([getLatestExternalResearch(req.query.caseId), getResearchSynthesisState(req.query.caseId)]);
        return res.status(200).json({ ...detail, externalResearch, synthesis });
      }
      return res.status(200).json(await getDailyResearchFeed({ limit: req.query.limit, status: req.query.status }));
    }
    if (req.method === 'POST') {
      const { action = 'external-research', caseId, window, refresh } = body(req);
      if (action === 'build-synthesis' || action === 'refresh-synthesis') return res.status(200).json(await buildAndPersistResearchSynthesis({ caseId }));
      if (action !== 'external-research') return res.status(400).json({ error: 'Invalid research action' });
      return res.status(200).json(await runExternalResearch({ caseId, window, force: refresh === true }));
    }
    if (req.method !== 'PATCH') return res.status(405).json({ error: 'Method not allowed' });
    const { caseId, status } = body(req);
    if (!validResearchCaseId(caseId)) return res.status(400).json({ error: 'Invalid research case id', reason: 'INVALID_CASE_ID' });
    const detail = await getResearchCaseDetail(caseId);
    if (detail?.unavailable) return res.status(410).json(detail);
    const saved = await updateResearchCaseStatus({ caseId, protocolId: detail.protocol.id, snapshotDate: detail.snapshot.date, status });
    return res.status(200).json({ id: caseId, status: saved });
  } catch (error) {
    if (error.message?.startsWith('Invalid')) return res.status(400).json({ error: error.message });
    console.error('Research request failed', error);
    return res.status(502).json({ error: error.message === 'External research storage is not ready. Run database migrations.' ? error.message : 'Research data is temporarily unavailable' });
  }
}
