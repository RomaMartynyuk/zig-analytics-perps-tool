import { PARTICIPATION_METHOD, utcWindow } from './participationMath.js';
import { participationUnavailableReason } from './participationCapabilities.js';
import { getParticipationAdapterSlugs } from './participationCollector.js';

const DAY = 86400000;
const LEASE = 'daily_participation';

// At noon UTC, collect yesterday's COMPLETE UTC trade tape. Before noon,
// continue the preceding target day rather than moving the window early.
export function dueParticipationDay(now = new Date()) {
  return new Date(now.getTime() - (now.getUTCHours() >= 12 ? DAY : 2 * DAY)).toISOString().slice(0, 10);
}

export function participationJobDays(startDay, now = new Date()) {
  const target = dueParticipationDay(now);
  const start = Date.parse(utcWindow(startDay).periodStart);
  const end = Date.parse(`${target}T00:00:00Z`);
  // Bounded recovery, not arbitrary historical backfill. Older missing dates
  // stay missing and require an explicit manual collection.
  const first = Math.max(start, end - 2 * DAY);
  const days = [];
  for (let date = first; date <= end; date += DAY) days.push(new Date(date).toISOString().slice(0, 10));
  return days;
}

export function participationWakeDelay(summary, cooldowns, now = new Date()) {
  const nextNoon = new Date(now);
  nextNoon.setUTCHours(12, 0, 0, 0);
  if (nextNoon <= now) nextNoon.setUTCDate(nextNoon.getUTCDate() + 1);
  const retries = [...cooldowns.values()].filter((until) => until > now.getTime());
  // No DB polling/lease heartbeats while all due days are complete. Allow
  // Neon to suspend normally until the next collection or scheduled retry.
  if (!summary || summary.failed || summary.complete) return 60000;
  return Math.max(1000, Math.min(nextNoon - now, ...(retries.length ? retries.map((until) => until - now.getTime()) : [])));
}

export function selectParticipationProtocols(registry, requested) {
  const slugs = requested.split(',').map((slug) => slug.trim()).filter(Boolean);
  if (!slugs.length) throw new Error('No participation protocols selected');
  const active = registry.filter((protocol) => protocol.isActive);
  for (const slug of slugs) if (!active.some((protocol) => protocol.slug === slug)) throw new Error(`Unknown/inactive participation protocol: ${slug}`);
  return active.filter((protocol) => slugs.includes(protocol.slug));
}

export async function acquireParticipationLease(sql, owner) {
  const rows = await sql`
    INSERT INTO participation_worker_leases (name, owner, expires_at)
    VALUES (${LEASE}, ${owner}, NOW() + INTERVAL '20 minutes')
    ON CONFLICT (name) DO UPDATE SET owner = EXCLUDED.owner,
      expires_at = EXCLUDED.expires_at, updated_at = NOW()
    WHERE participation_worker_leases.expires_at <= NOW()
    RETURNING owner
  `;
  return rows.length === 1;
}

export async function renewParticipationLease(sql, owner) {
  const rows = await sql`
    UPDATE participation_worker_leases SET expires_at = NOW() + INTERVAL '20 minutes', updated_at = NOW()
    WHERE name = ${LEASE} AND owner = ${owner} AND expires_at > NOW() RETURNING owner
  `;
  return rows.length === 1;
}

export async function releaseParticipationLease(sql, owner) {
  await sql`DELETE FROM participation_worker_leases WHERE name = ${LEASE} AND owner = ${owner}`;
}

export async function participationDayComplete(sql, slug, day) {
  const rows = await sql`
    SELECT d.collection_complete FROM protocol_participation_daily d
    JOIN protocols p ON p.id = d.protocol_id
    WHERE p.slug = ${slug} AND p.is_active = TRUE AND d.snapshot_date = ${day}
      AND d.market_id IS NULL AND d.methodology_version = ${PARTICIPATION_METHOD}
  `;
  return rows.some((row) => row.collection_complete === true);
}

// One bounded batch per protocol per round prevents a busy venue starving
// the others. Only the trusted adapter/DB layer decides publication quality.
export async function runParticipationRound({ protocols, startDay, now = new Date(),
  completed, runBatch, cooldowns = new Map(), log = () => {}, signal,
  supported = getParticipationAdapterSlugs() }) {
  const summary = { complete: 0, partial: 0, failed: 0, blocked: 0, skipped: 0, unavailable: [] };
  const days = participationJobDays(startDay, now);
  for (const protocol of protocols) {
    if (!supported.includes(protocol.slug)) {
      summary.unavailable.push({ slug: protocol.slug, reason: participationUnavailableReason(protocol.slug) });
      continue;
    }
    for (const day of days) {
      if (signal?.aborted) return summary;
      const key = `${protocol.slug}:${day}`;
      if ((cooldowns.get(key) || 0) > now.getTime()) { summary.skipped++; continue; }
      if (await completed(protocol.slug, day)) { summary.skipped++; continue; }
      let code;
      try { code = await runBatch(protocol.slug, day, signal); }
      catch { code = 1; }
      if (signal?.aborted) return summary;
      if (code === 0 && await completed(protocol.slug, day)) {
        summary.complete++;
        cooldowns.delete(key);
      } else {
        const state = code === 2 ? 'blocked' : code === 0 ? 'partial' : 'failed';
        summary[state]++;
        // Use completion time, not the round start: batches can take minutes.
        cooldowns.set(key, Math.max(Date.now(), now.getTime()) + (code === 2 ? 6 * 3600000 : code ? 5 * 60000 : 60000));
        log({ protocol: protocol.slug, day, status: state.toUpperCase(), publicMetrics: 'Use database quality flags; no partial totals are published' });
      }
      break;
    }
  }
  return summary;
}
