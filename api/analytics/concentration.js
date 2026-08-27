import { getMarketConcentrationHistory } from '../../server/analyticsService.js';

export default async function handler(req, res) {
  try {
    return res.status(200).json(await getMarketConcentrationHistory({ metric: req.query.metric || 'volume', period: req.query.period }));
  } catch (error) {
    return res.status(400).json({ error: String(error?.message || error) });
  }
}
