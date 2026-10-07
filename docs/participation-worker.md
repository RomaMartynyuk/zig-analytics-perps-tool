# Daily participant worker

The website stays on Vercel. Participant collection runs separately on a persistent Node host: full scans take longer than Vercel's [Hobby function limit](https://vercel.com/docs/functions/limitations). No host, deployment or OS service has been provisioned automatically.

## Schedule and correctness

- At **12:00 UTC**, collect the **previous completed UTC trade day**, `[00:00, next 00:00)`. Before noon, continue the preceding target. This does not change the site's existing noon rolling Volume/OI snapshot cron.
- Initial start defaults to yesterday and is saved in `worker-start-date` across restarts. `PARTICIPATION_START_DATE` overrides the initial bound only before this file exists.
- Recovery considers at most the latest three due days, never dates before the initial bound. Older gaps remain missing and require explicit manual real-day collection, not synthetic backfill.
- One batch per supported selected protocol per round, serially: up to 1,000 pages / 10 minutes, with an outer 11-minute watchdog. Partial work resumes from the same private checkpoint. No duplicate protocol/date/methodology rows.
- Partial batches wait at least 60 seconds; errors wait 5 minutes; unsafe pagination waits 6 hours and needs investigation. Existing adapter rate limits/adaptive pacing stay intact.
- A Neon singleton lease prevents competing worker hosts. It expires after 20 minutes and renews once per minute during active rounds. Failed renewal stops collection. The lease is released during idle waits; a finished worker sleeps until noon without continually waking Neon.
- Completion is read from the exact protocol/date/methodology DB row. Completed days are not fetched again. Completion does **not** imply validated concentration: Arcus's missing candles still suppress protocol-wide HHI/Top metrics.
- Default priority job selection is `arcus,lighter,variational`, validated against the existing active registry on each round. Variational reports unsupported and makes no trade requests. This job selection is not a second analytics universe.

## Environment and migrations

Use Node22 LTS or Node24 and existing locked dependencies (`npm ci`). Supply server-only variables:

```dotenv
DATABASE_URL=your_existing_Neon_connection_string
PARTICIPATION_CHECKPOINT_DIR=/absolute/private/persistent/zig-participation
PARTICIPATION_PROTOCOLS=arcus,lighter,variational
# Optional initial first real trade day:
# PARTICIPATION_START_DATE=YYYY-MM-DD
```

Never use `VITE_*` for secrets or commit a populated environment file. No new public endpoint/CRON_SECRET is needed. Migration010 adds only `participation_worker_leases` (name, UUID owner, expiry, updated timestamp); no account or trade data goes there.

```sh
npm run db:migrate
PARTICIPATION_CHECKPOINT_DIR=/absolute/private/persistent/zig-participation npm run participation:worker -- --dry-run
```

Dry-run validates selection/dates and prints planned work, with **no network or writes**. It does not prove DB access, resume an existing start-date file or validate complete source coverage.

## Manual first round / continuous worker

Local test, explicitly loading the existing environment:

```sh
PARTICIPATION_CHECKPOINT_DIR=/absolute/private/persistent/zig-participation node --env-file=.env.local scripts/participation-worker.js --once
```

`--once` means one round, not necessarily a whole day. Exit0 can mean partial; inspect `ROUND_FINISHED` and DB quality flags. Before the first noon, the new worker intentionally waits. Production uses host-provided environment:

```sh
npm run participation:worker
```

Only one supervised process should run. Do not simultaneously invoke the diagnostic CLI, which does **not** acquire the scheduler lease. Stop the service before manual collection/investigation. Explicit real-day continuation:

```sh
PARTICIPATION_CHECKPOINT_DIR=/absolute/private/persistent/zig-participation npm run check:participation -- lighter --day=YYYY-MM-DD --persist --max-pages=1000 --budget-ms=600000 --max-runs=100
```

Previous `/tmp/zig-participation-checkpoints` progress does not automatically migrate to a different directory/host. If retaining it, securely copy the specific checkpoint with worker stopped before its 48-hour idle expiry. Never expose its salt/cursor/hashed account aggregates or commit it. If expired, restart the official real-day scan rather than inventing earlier work.

## Linux service

`ops/zig-participation.service` is a template, **not an installed service**. Host prerequisites: a dedicated `zig` user/group, checkout plus dependencies at `/opt/zig-analytics`, Node at `/usr/bin/node` (adjust if different), and populated settings based on `ops/participation.env.example` in `/etc/zig-analytics/participation.env` (root-owned mode0600). systemd reads secrets before dropping privileges.

After host prerequisites:

```sh
sudo install -m 0644 ops/zig-participation.service /etc/systemd/system/zig-participation.service
sudo systemctl daemon-reload
sudo systemctl enable --now zig-participation
sudo systemctl status zig-participation
sudo journalctl -u zig-participation -n 50 --no-pager
```

The service creates private persistent `/var/lib/zig-participation`, restarts on failure, and terminates the process group on shutdown. No extra system cron needed. The Node scheduler handles UTC timing. Interrupted collection retains the last atomic page checkpoint; a crash's lease expires. Another host needs the **same private durable volume** to resume, not just the same DB.

macOS foreground execution works only while the Mac is running. No launch agent is installed. An always-on host is preferable.

## Verify rows / logs

In Neon SQL Editor:

```sql
SELECT p.slug, d.snapshot_date, d.collection_complete, d.quality_state,
       d.active_participants, d.attributed_volume_usd, d.coverage_ratio,
       d.hhi, d.updated_at
FROM protocol_participation_daily d
JOIN protocols p ON p.id = d.protocol_id
WHERE d.market_id IS NULL
ORDER BY d.snapshot_date DESC, p.slug;
```

Partial rows stay NULL; unsupported Variational may have no row. API coverage still uses the full active registry, not just the selected jobs. Observe `BATCH_STARTED`, `ROUND_FINISHED`, `WAITING` and lease/failure messages. Raw child diagnostics are not forwarded to service logs to avoid secret/identity leakage. Investigate failures via the protected existing CLI after stopping the worker. No external monitoring/telemetry added.

## Limitations and privacy

Rate-limited throughput may still be insufficient for Lighter's entire daily population. Measure a full day on the chosen host. Checkpoints/memory grow with participants × traded markets, not merely published row count; provision adequate RAM/disk. Provider retention and availability are external constraints. Never publish incomplete totals to make collection look successful.

Atomic checkpoints are mode0600 in a mode0700 directory, deleted on successful complete persistence or after 48 hours idle. Only quality-gated daily aggregates remain in Neon. Protect disk/backups: hashes plus salts are not anonymous against a disk attacker.

Automatic collection is **prepared, not activated** until a worker host is chosen/configured. No Vercel deploy, new serverless function, UI changes, financial formula changes or source-quality relaxation.

## Checks actually performed (2026-10-07)

- All150 existing/new Node tests passed, including12 worker-focused tests; targeted lint, syntax and diff checks passed.
- Migration010 applied to the configured Neon. Real temporary lease test: first owner acquired, second owner blocked, first owner renewed, lease released.
- One actual scheduler round for already-complete Arcus2026-10-06 skipped the day, made no adapter calls and exited normally. No continuous service left running.
- Network-free dry-run passed. Frontend build passed using the existing clean temporary dependency workspace; frontend source is unchanged in this worker follow-up.
- Linux systemd activation, host restart/disk recovery and a complete Lighter daily scan are **not verified**: a worker host has not been selected/provisioned.
