import { getGrowthMetrics } from '../../server/analyticsService.js';

export default async function handler(req, res) {
  try {
    return res.status(200).json(await getGrowthMetrics({ metric: req.query.metric, period: req.query.period }));
  } catch (error) {
    return res.status(400).json({ error: String(error?.message || error) });
  }
}
