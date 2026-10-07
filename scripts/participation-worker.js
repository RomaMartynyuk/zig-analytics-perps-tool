import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile, rename, chmod, readdir, stat, unlink } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getSql } from '../server/db.js';
import { getConfiguredProtocols } from '../server/protocolRegistry.js';
import { acquireParticipationLease, renewParticipationLease, releaseParticipationLease,
  participationDayComplete, participationJobDays, participationWakeDelay, runParticipationRound, selectParticipationProtocols } from '../server/participationWorker.js';
import { utcWindow } from '../server/participationMath.js';

const root = fileURLToPath(new URL('../', import.meta.url));
const args = process.argv.slice(2);
if (args.some((arg) => !['--once', '--dry-run'].includes(arg))) throw new Error('Supported options: --once, --dry-run');
const directory = process.env.PARTICIPATION_CHECKPOINT_DIR;
if (!directory) throw new Error('PARTICIPATION_CHECKPOINT_DIR must point to a persistent private worker directory');
const checkpointDir = resolve(directory);
const requested = process.env.PARTICIPATION_PROTOCOLS || 'arcus,lighter,variational';
// This is a worker selection, NOT a second protocol registry. Validate it
// against the live central registry on every round (including active flags).
const protocols = () => selectParticipationProtocols(getConfiguredProtocols(), requested);
const proposedStart = process.env.PARTICIPATION_START_DATE || new Date(Date.now() - 86400000).toISOString().slice(0, 10);
utcWindow(proposedStart);
const log = (event) => console.log(JSON.stringify({ at: new Date().toISOString(), ...event }));
if (args.includes('--dry-run')) {
  log({ status: 'DRY_RUN_NO_NETWORK_NO_WRITES', triggerUtc: '12:00', startDay: proposedStart,
    dueDays: participationJobDays(proposedStart), protocols: protocols().map((protocol) => protocol.slug),
    checkpointDirectory: checkpointDir });
} else {
  const sql = getSql();
  const owner = randomUUID();
  const abort = new AbortController();
  const stop = () => abort.abort();
  process.once('SIGTERM', stop);
  process.once('SIGINT', stop);
  const cooldowns = new Map();
  try { do {
  let summary;
  if (!await acquireParticipationLease(sql, owner)) {
    log({ status: 'ANOTHER_WORKER_HAS_LEASE' });
    if (args.includes('--once')) process.exitCode = 1;
  } else {
    let heartbeatBusy = false;
    const heartbeat = setInterval(async () => {
      if (heartbeatBusy || abort.signal.aborted) return;
      heartbeatBusy = true;
      try { if (!await renewParticipationLease(sql, owner)) { log({ status: 'LEASE_LOST_STOPPING' }); stop(); } }
      catch { log({ status: 'LEASE_RENEWAL_FAILED_STOPPING' }); stop(); }
      finally { heartbeatBusy = false; }
    }, 60000);
    try {
      await mkdir(checkpointDir, { recursive: true, mode: 0o700 });
      await chmod(checkpointDir, 0o700);
      const startFile = join(checkpointDir, 'worker-start-date');
      let startDay;
      try { startDay = (await readFile(startFile, 'utf8')).trim(); utcWindow(startDay); }
      catch (error) {
        if (error.code !== 'ENOENT') throw error;
        startDay = proposedStart;
        await writeFile(`${startFile}.tmp`, `${startDay}\n`, { mode: 0o600 });
        await rename(`${startFile}.tmp`, startFile);
      }
      const runBatch = (slug, day, signal) => new Promise((done) => {
        // Reuse the existing collector CLI, normalization, retry policy and
        // persistence. Never replicate integrations in the scheduler.
        const child = spawn(process.execPath, [join(root, 'scripts/check-participation.js'), slug,
          `--day=${day}`, '--persist', '--max-pages=1000', '--budget-ms=600000', '--max-runs=1'], {
          cwd: root, env: { ...process.env, PARTICIPATION_CHECKPOINT_DIR: checkpointDir }, stdio: 'ignore',
        });
        let killTimer;
        const terminate = () => {
          child.kill('SIGTERM');
          killTimer ||= setTimeout(() => child.kill('SIGKILL'), 5000);
        };
        signal.addEventListener('abort', terminate, { once: true });
        if (signal.aborted) terminate();
        // Hard outer budget includes DB writes, request timeouts and shutdown.
        const watchdog = setTimeout(terminate, 660000);
        const finish = (code) => {
          clearTimeout(watchdog); clearTimeout(killTimer);
          signal.removeEventListener('abort', terminate);
          done(Number.isInteger(code) ? code : 1);
        };
        child.once('error', () => finish(1));
        child.once('exit', finish);
        log({ status: 'BATCH_STARTED', protocol: slug, day });
      });
        try {
          summary = await runParticipationRound({ protocols: protocols(), startDay, cooldowns,
            completed: (slug, day) => participationDayComplete(sql, slug, day), runBatch, log, signal: abort.signal });
          log({ status: 'ROUND_FINISHED', ...summary });
          if (args.includes('--once') && summary.failed) process.exitCode = 1;
          // Delete private checkpoints only after 48h idle, never a live file.
          for (const name of await readdir(checkpointDir)) {
            if (!/^[a-z0-9-]+-\d{4}-\d{2}-\d{2}\.json(?:\.tmp)?$/.test(name)) continue;
            const path = join(checkpointDir, name);
            if (Date.now() - (await stat(path)).mtimeMs > 172800000) await unlink(path);
          }
          // Bounded memory: old cooldown entries are no longer applicable.
          for (const [key, until] of cooldowns) if (until < Date.now()) cooldowns.delete(key);
        } catch {
          log({ status: 'ROUND_FAILED_RETRY_IN_60_SECONDS', detail: 'Inspect database connectivity, migration status and worker configuration; secrets omitted' });
          if (args.includes('--once')) process.exitCode = 1;
        }
    } finally {
      clearInterval(heartbeat);
      await releaseParticipationLease(sql, owner).catch(() => log({ status: 'LEASE_RELEASE_FAILED_EXPIRES_AUTOMATICALLY' }));
    }
  }
  if (args.includes('--once') || abort.signal.aborted) break;
  const delay = participationWakeDelay(summary, cooldowns);
  log({ status: 'WAITING', resumeAt: new Date(Date.now() + delay).toISOString() });
  await new Promise((done) => {
    const complete = () => { clearTimeout(timer); abort.signal.removeEventListener('abort', complete); done(); };
    const timer = setTimeout(complete, delay);
    abort.signal.addEventListener('abort', complete, { once: true });
    if (abort.signal.aborted) complete();
  });
  } while (!abort.signal.aborted); }
  finally { process.removeListener('SIGTERM', stop); process.removeListener('SIGINT', stop); }
}
