CREATE TABLE IF NOT EXISTS signal_observations (
  id BIGSERIAL PRIMARY KEY,
  snapshot_date DATE NOT NULL,
  protocol_id BIGINT NOT NULL REFERENCES protocols(id),
  protocol_slug TEXT NOT NULL,
  series_key TEXT NOT NULL,
  signal_family TEXT NOT NULL,
  signal_type TEXT,
  state TEXT NOT NULL CHECK (state IN ('PRESENT', 'ABSENT', 'NOT_EVALUABLE')),
  not_evaluable_reason TEXT,
  score NUMERIC,
  severity TEXT,
  evidence_json JSONB,
  comparison_json JSONB,
  peer_context_json JSONB,
  coverage_json JSONB,
  engine_version TEXT NOT NULL,
  evaluation_mode TEXT NOT NULL CHECK (evaluation_mode IN ('RETROSPECTIVE', 'LIVE_RECORDED')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (snapshot_date, protocol_id, series_key, engine_version, evaluation_mode)
);
-- migrate:split
CREATE INDEX IF NOT EXISTS signal_observations_series_idx
  ON signal_observations (protocol_id, series_key, engine_version, snapshot_date DESC);
