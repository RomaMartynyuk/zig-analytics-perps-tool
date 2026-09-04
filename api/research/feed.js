import { getDailyResearchFeed, updateResearchCaseStatus } from '../../server/researchFeedService.js';

function body(req) {
  if (!req.body) return {};
  if (typeof req.body === 'string') { try { return JSON.parse(req.body); } catch { return {}; } }
  return req.body;
}

export default async function handler(req, res) {
  try {
    if (req.method === 'GET') return res.status(200).json(await getDailyResearchFeed({ limit: req.query.limit, status: req.query.status }));
    if (req.method !== 'PATCH') return res.status(405).json({ error: 'Method not allowed' });
    const { caseId, status } = body(req);
    const feed = await getDailyResearchFeed({ limit: 20, status: 'all' });
    const item = feed.cases.find((candidate) => candidate.id === caseId);
    if (!item) return res.status(404).json({ error: 'Research case not found for the current canonical snapshot' });
    const saved = await updateResearchCaseStatus({ caseId, protocolId: item.protocol.id, snapshotDate: item.snapshotDate, status });
    return res.status(200).json({ id: caseId, status: saved });
  } catch (error) {
    if (error.message?.startsWith('Invalid')) return res.status(400).json({ error: error.message });
    console.error('Daily Research Feed request failed', error);
    return res.status(502).json({ error: 'Daily Research Feed is temporarily unavailable' });
  }
}
