import { getVolumeOiAnalysis } from '../../server/analyticsService.js';

export default async function handler(req, res) {
  try {
    return res.status(200).json(await getVolumeOiAnalysis());
  } catch {
    return res.status(502).json({ error: 'Analytics data is unavailable' });
  }
}
