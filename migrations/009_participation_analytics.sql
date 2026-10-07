-- Financial totals are decimal; identities/raw fills are never stored here.
CREATE TABLE IF NOT EXISTS protocol_participation_daily (
  id BIGSERIAL PRIMARY KEY,
  protocol_id BIGINT NOT NULL REFERENCES protocols(id),
  snapshot_date DATE NOT NULL,
  market_id TEXT,
  period_start TIMESTAMPTZ NOT NULL,
  period_end TIMESTAMPTZ NOT NULL,
  participant_type TEXT NOT NULL CHECK (participant_type IN ('ADDRESS', 'ACCOUNT', 'SUBACCOUNT', 'UNKNOWN')),
  active_participants INTEGER CHECK (active_participants >= 0),
  attributed_volume_usd NUMERIC(38, 8) CHECK (attributed_volume_usd >= 0),
  comparable_volume_usd NUMERIC(38, 8) CHECK (comparable_volume_usd >= 0),
  coverage_ratio NUMERIC(20, 10) CHECK (coverage_ratio >= 0),
  mean_volume_per_participant NUMERIC(38, 8),
  median_volume_per_participant NUMERIC(38, 8),
  p90_volume_per_participant NUMERIC(38, 8),
  top1_share NUMERIC(20, 10) CHECK (top1_share BETWEEN 0 AND 100),
  top5_share NUMERIC(20, 10) CHECK (top5_share BETWEEN 0 AND 100),
  top10_share NUMERIC(20, 10) CHECK (top10_share BETWEEN 0 AND 100),
  top1pct_share NUMERIC(20, 10) CHECK (top1pct_share BETWEEN 0 AND 100),
  hhi NUMERIC(20, 12) CHECK (hhi BETWEEN 0 AND 1),
  effective_participants NUMERIC(30, 10),
  source TEXT NOT NULL,
  source_type TEXT NOT NULL,
  attribution TEXT NOT NULL,
  methodology_version TEXT NOT NULL,
  quality_state TEXT NOT NULL CHECK (quality_state IN ('COMPLETE', 'HIGH', 'PARTIAL', 'LOW', 'UNAVAILABLE')),
  collection_complete BOOLEAN NOT NULL DEFAULT FALSE,
  signal_eligible BOOLEAN NOT NULL DEFAULT FALSE,
  diagnostics JSONB NOT NULL DEFAULT '{}',
  captured_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (period_end > period_start)
);
-- migrate:split
CREATE UNIQUE INDEX IF NOT EXISTS participation_daily_identity
  ON protocol_participation_daily (protocol_id, snapshot_date, (COALESCE(market_id, '')), methodology_version);
-- migrate:split
CREATE INDEX IF NOT EXISTS participation_daily_date ON protocol_participation_daily (snapshot_date);
