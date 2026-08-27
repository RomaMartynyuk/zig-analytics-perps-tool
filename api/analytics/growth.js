import { getGrowthMatrix, getGrowthMetrics } from '../../server/analyticsService.js';

export default async function handler(req, res) {
  try {
    const response = req.query.matrix === '1'
      ? await getGrowthMatrix({ period: req.query.period })
      : await getGrowthMetrics({ metric: req.query.metric, period: req.query.period });
    return res.status(200).json(response);
  } catch (error) {
    return res.status(400).json({ error: String(error?.message || error) });
  }
}
