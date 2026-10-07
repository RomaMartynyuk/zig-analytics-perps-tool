export async function saveParticipation(sql, protocolId, result) {
  const diagnostics = { ...result.diagnostics, officialObservation: result.officialObservation, reason: result.reason };
  for (const row of result.rows) {
    await sql`
      INSERT INTO protocol_participation_daily (
        protocol_id, snapshot_date, market_id, period_start, period_end,
        participant_type, active_participants, attributed_volume_usd, comparable_volume_usd,
        coverage_ratio, mean_volume_per_participant, median_volume_per_participant,
        p90_volume_per_participant, top1_share, top5_share, top10_share, top1pct_share,
        hhi, effective_participants, source, source_type, attribution, methodology_version,
        quality_state, collection_complete, signal_eligible, diagnostics
      ) VALUES (
        ${protocolId}, ${result.snapshotDate}, ${row.marketId}, ${result.periodStart}, ${result.periodEnd},
        ${result.participantType}, ${row.activeParticipants}, ${row.attributedVolumeUsd}, ${row.comparableVolumeUsd},
        ${row.coverageRatio}, ${row.meanVolumePerParticipant}, ${row.medianVolumePerParticipant},
        ${row.p90VolumePerParticipant}, ${row.top1Share}, ${row.top5Share}, ${row.top10Share}, ${row.top1pctShare},
        ${row.hhi}, ${row.effectiveParticipants}, ${result.source}, ${result.sourceType}, ${result.attribution},
        ${result.methodologyVersion}, ${row.qualityState}, ${result.complete}, ${false}, ${JSON.stringify(diagnostics)}
      ) ON CONFLICT (protocol_id, snapshot_date, (COALESCE(market_id, '')), methodology_version)
      DO UPDATE SET
        period_start = EXCLUDED.period_start, period_end = EXCLUDED.period_end,
        active_participants = EXCLUDED.active_participants,
        attributed_volume_usd = EXCLUDED.attributed_volume_usd, comparable_volume_usd = EXCLUDED.comparable_volume_usd,
        coverage_ratio = EXCLUDED.coverage_ratio, mean_volume_per_participant = EXCLUDED.mean_volume_per_participant,
        median_volume_per_participant = EXCLUDED.median_volume_per_participant,
        p90_volume_per_participant = EXCLUDED.p90_volume_per_participant,
        top1_share = EXCLUDED.top1_share, top5_share = EXCLUDED.top5_share, top10_share = EXCLUDED.top10_share,
        top1pct_share = EXCLUDED.top1pct_share, hhi = EXCLUDED.hhi, effective_participants = EXCLUDED.effective_participants,
        quality_state = EXCLUDED.quality_state, collection_complete = EXCLUDED.collection_complete,
        signal_eligible = FALSE, diagnostics = EXCLUDED.diagnostics, captured_at = NOW(), updated_at = NOW()
      WHERE NOT protocol_participation_daily.collection_complete OR EXCLUDED.collection_complete
    `;
  }
  return result.rows.length;
}
