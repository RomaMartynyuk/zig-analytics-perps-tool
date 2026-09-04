import { getSignals } from '../../server/analyticsService.js';

export default async function handler(req, res) {
  try {
    return res.status(200).json(await getSignals({ period: req.query.period, category: req.query.category, limit: req.query.limit }));
  } catch (error) {
    // Keep the client response safe, while retaining actionable diagnostics in
    // Vercel logs for an unexpected database or analytics-layer failure.
    console.error('Zig Signals request failed', error);
    return res.status(502).json({ error: 'Signals are temporarily unavailable' });
  }
}
