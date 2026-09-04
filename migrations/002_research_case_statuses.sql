CREATE TABLE IF NOT EXISTS research_case_statuses (
  research_case_id TEXT PRIMARY KEY,
  protocol_id BIGINT NOT NULL REFERENCES protocols(id) ON DELETE CASCADE,
  snapshot_date DATE NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('IGNORED', 'WATCHING', 'RESEARCHING')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- migrate:split

CREATE INDEX IF NOT EXISTS research_case_statuses_snapshot_idx
  ON research_case_statuses (snapshot_date DESC);

-- migrate:split

CREATE INDEX IF NOT EXISTS research_case_statuses_protocol_idx
  ON research_case_statuses (protocol_id, snapshot_date DESC);
