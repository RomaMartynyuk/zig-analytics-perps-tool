import { collectDailyProtocolSnapshots } from '../../server/snapshotCollector.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const authorization = req.headers.authorization;
  if (!process.env.CRON_SECRET || authorization !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const summary = await collectDailyProtocolSnapshots();
    return res.status(summary.failed ? 207 : 200).json(summary);
  } catch (error) {
    console.error('[snapshots] collection could not start:', String(error?.message || error));
    return res.status(502).json({ error: 'Snapshot collection failed to start' });
  }
}
