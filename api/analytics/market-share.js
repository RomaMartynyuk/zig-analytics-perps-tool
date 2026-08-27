import { getMarketShareHistory } from '../../server/analyticsService.js';

export default async function handler(req, res) {
  try {
    const protocols = typeof req.query.protocols === 'string'
      ? req.query.protocols.split(',').map((slug) => slug.trim()).filter(Boolean)
      : undefined;
    const result = await getMarketShareHistory({ metric: req.query.metric, period: req.query.period, protocols });
    return res.status(200).json(result);
  } catch (error) {
    return res.status(400).json({ error: String(error?.message || error) });
  }
}
