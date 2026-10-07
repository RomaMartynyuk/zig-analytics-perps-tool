import { getMarketConcentrationHistory } from '../../server/analyticsService.js';
import { getParticipationAnalytics } from '../../server/participationService.js';

export default async function handler(req, res) {
  try {
    if (req.query.view === 'participation') return res.status(200).json(await getParticipationAnalytics({ period: req.query.period || '24h', marketId: req.query.marketId || null, protocolSlug: req.query.protocol || null }));
    return res.status(200).json(await getMarketConcentrationHistory({ metric: req.query.metric || 'volume', period: req.query.period }));
  } catch (error) {
    return res.status(400).json({ error: String(error?.message || error) });
  }
}
