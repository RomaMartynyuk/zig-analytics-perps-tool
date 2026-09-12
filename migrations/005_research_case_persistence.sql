CREATE TABLE IF NOT EXISTS research_cases (
  id TEXT PRIMARY KEY,
  protocol_id BIGINT NOT NULL REFERENCES protocols(id) ON DELETE RESTRICT,
  protocol_slug TEXT NOT NULL,
  snapshot_date DATE NOT NULL,
  signal_family TEXT NOT NULL,
  headline TEXT NOT NULL,
  score NUMERIC(8, 4) NOT NULL,
  severity TEXT NOT NULL,
  period TEXT NOT NULL,
  payload_version INTEGER NOT NULL CHECK (payload_version > 0),
  case_payload JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  first_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- migrate:split

CREATE INDEX IF NOT EXISTS research_cases_snapshot_idx
  ON research_cases (snapshot_date DESC, id);

-- migrate:split

CREATE INDEX IF NOT EXISTS research_cases_protocol_idx
  ON research_cases (protocol_slug, snapshot_date DESC);
