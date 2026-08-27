import { collectDailyProtocolSnapshots } from '../api/lib/snapshotCollector.js';

const summary = await collectDailyProtocolSnapshots();
console.log(JSON.stringify(summary, null, 2));
if (summary.failed) process.exitCode = 1;
