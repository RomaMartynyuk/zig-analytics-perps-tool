CREATE TABLE IF NOT EXISTS research_watch_evaluations (
  id BIGSERIAL PRIMARY KEY, case_id TEXT NOT NULL REFERENCES research_cases(id), series_key TEXT NOT NULL,
  canonical_date DATE NOT NULL, signal_state TEXT NOT NULL CHECK (signal_state IN ('PRESENT','ABSENT','NOT_EVALUABLE')),
  lifecycle_state TEXT, lifecycle_confidence TEXT, score NUMERIC, strength_value NUMERIC, strength_metric TEXT,
  reappeared BOOLEAN NOT NULL DEFAULT FALSE, engine_version TEXT NOT NULL, lifecycle_version TEXT NOT NULL,
  metadata_json JSONB NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(case_id, canonical_date, engine_version, lifecycle_version)
);
-- migrate:split
CREATE INDEX IF NOT EXISTS research_watch_evaluations_case_date_idx ON research_watch_evaluations(case_id, canonical_date DESC, id DESC);
