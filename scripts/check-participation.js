import { readFile, writeFile, unlink, stat, mkdir, rename } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { getConfiguredProtocols } from '../server/protocolRegistry.js';
import { collectParticipation } from '../server/participationCollector.js';
import { getSql } from '../server/db.js';
import { syncProtocols } from '../server/snapshotRepository.js';
import { saveParticipation } from '../server/participationRepository.js';

const args = process.argv.slice(2);
const get = (key, fallback) => args.find((arg) => arg.startsWith(`${key}=`))?.slice(key.length + 1) || fallback;
const requested = args.find((arg) => !arg.startsWith('--')) || 'n1';
const day = get('--day', new Date(Date.now() - 86400000).toISOString().slice(0, 10));
if (Date.parse(`${day}T00:00:00Z`) + 86400000 > Date.now()) throw new Error('Only completed UTC calendar days may be collected');
const selected = getConfiguredProtocols().filter((protocol) => protocol.slug === requested || protocol.metricsKey.toLowerCase() === requested.toLowerCase());
if (!selected.length) throw new Error('Unknown protocol in central registry');
const maxPages = Number(get('--max-pages', '100'));
const maxDurationMs = Number(get('--budget-ms', '50000'));
const maxRuns = Number(get('--max-runs', '1'));
if (!Number.isInteger(maxPages) || maxPages < 1 || maxPages > 1000 || !Number.isFinite(maxDurationMs) || maxDurationMs < 1000 || maxDurationMs > 600000) throw new Error('Invalid collection budget');
if (!Number.isInteger(maxRuns) || maxRuns < 1 || maxRuns > 100) throw new Error('Invalid bounded worker run count');
// A dedicated worker supplies a persistent private directory; Vercel /tmp
// is deliberately NOT treated as durable storage.
const directory = process.env.PARTICIPATION_CHECKPOINT_DIR
  ? resolve(process.env.PARTICIPATION_CHECKPOINT_DIR)
  : join(tmpdir(), 'zig-participation-checkpoints');
await mkdir(directory, { recursive: true, mode: 0o700 });
const path = join(directory, `${selected[0].slug}-${day}.json`);
let checkpoint = null;
try {
  const info = await stat(path);
  if (Date.now() - info.mtimeMs > 172800000) { await unlink(path); }
  else checkpoint = JSON.parse(await readFile(path, 'utf8'));
} catch (error) { if (error.code !== 'ENOENT') throw error; }
const persist = args.includes('--persist');
let sql, registry;
if (persist) { sql = getSql(); registry = await syncProtocols(sql, getConfiguredProtocols()); }
let lastProgress = Date.now();
for (let run = 0; run < maxRuns; run++) {
  let blocked = false;
  const summary = await collectParticipation({ protocols: selected, day, checkpoint, maxPages, maxDurationMs,
    onCheckpoint: async (state) => {
      await writeFile(`${path}.tmp`, JSON.stringify(state), { mode: 0o600 });
      await rename(`${path}.tmp`, path);
      if (Date.now() - lastProgress >= 30000) {
        console.log(JSON.stringify({ status: 'COLLECTING_NOT_FINAL_METRICS', protocol: selected[0].slug, day, acceptedExecutions: state.accumulator?.accepted || 0, completedMarketChecks: state.marketIndex ?? state.candleIndex ?? null, catalogMarkets: state.markets?.length || 0, scanComplete: state.complete }));
        lastProgress = Date.now();
      }
    },
    onResult: async (protocol, result) => {
      checkpoint = result.checkpoint;
      blocked = Boolean(checkpoint?.blockedReason);
      if (persist) await saveParticipation(sql, registry.get(protocol.slug).id, result);
      // No raw participant IDs, hashes, salts or raw trades in output/persistence.
      const { checkpoint: _privateCheckpoint, rows, ...report } = result;
      console.log(JSON.stringify({ ...report, publicAggregate: rows.find((row) => row.marketId === null), marketAggregates: rows.length - 1, persisted: persist, observedDiagnosticWarning: 'Observed distribution is NOT a reconciled public concentration estimate.' }, null, 2));
      if (result.complete) await unlink(path).catch((error) => { if (error.code !== 'ENOENT') throw error; });
    },
  });
  console.log(JSON.stringify(summary, null, 2));
  if (summary.failed.length) process.exitCode = 1;
  if (blocked) process.exitCode = 2;
  if (summary.partial.length) console.log(blocked ? 'Pagination could not advance safely. Further batches stopped; checkpoint preserved for investigation.' : 'Budget reached. Run the same command again within 48h to resume the frozen UTC day. No daily population/concentration is published from an incomplete scan.');
  if (!summary.partial.length || summary.failed.length || blocked) break;
  if (run + 1 < maxRuns) console.log(`Continuing bounded batch ${run + 2}/${maxRuns} for the SAME UTC day ${day}.`);
}
