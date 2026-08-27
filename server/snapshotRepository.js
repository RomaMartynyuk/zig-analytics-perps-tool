// Server-only persistence operations for normalized daily snapshots.
export async function syncProtocols(sql, protocols) {
  const rows = await Promise.all(protocols.map(async (protocol) => {
    const result = await sql`
      INSERT INTO protocols (slug, name, is_active)
      VALUES (${protocol.slug}, ${protocol.name}, ${protocol.isActive})
      ON CONFLICT (slug) DO UPDATE SET
        name = EXCLUDED.name,
        is_active = EXCLUDED.is_active,
        updated_at = NOW()
      RETURNING id, slug, name, is_active
    `;
    return result[0];
  }));

  return new Map(rows.map((row) => [row.slug, row]));
}

/**
 * The unique key makes this safe for cron retries: a second collection on the
 * same UTC date updates the canonical row instead of inserting a duplicate.
 */
export async function upsertDailySnapshot(sql, snapshot) {
  const result = await sql`
    INSERT INTO protocol_daily_snapshots (
      protocol_id, snapshot_date, captured_at, volume_24h, open_interest,
      tvl, markets_count, data_source, source_updated_at
    )
    VALUES (
      ${snapshot.protocolId}, ${snapshot.snapshotDate}, ${snapshot.capturedAt},
      ${snapshot.volume24h}, ${snapshot.openInterest}, ${snapshot.tvl},
      ${snapshot.marketsCount}, ${snapshot.dataSource}, ${snapshot.sourceUpdatedAt}
    )
    ON CONFLICT (protocol_id, snapshot_date) DO UPDATE SET
      captured_at = EXCLUDED.captured_at,
      volume_24h = EXCLUDED.volume_24h,
      open_interest = EXCLUDED.open_interest,
      tvl = EXCLUDED.tvl,
      markets_count = EXCLUDED.markets_count,
      data_source = EXCLUDED.data_source,
      source_updated_at = EXCLUDED.source_updated_at,
      updated_at = NOW()
    RETURNING id, protocol_id, snapshot_date
  `;
  return result[0];
}
