import { getSignals } from '../../server/analyticsService.js';

export default async function handler(req, res) {
  try {
    return res.status(200).json(await getSignals({ period: req.query.period, category: req.query.category, limit: req.query.limit }));
  } catch {
    return res.status(502).json({ error: 'Signals are temporarily unavailable' });
  }
}
