CREATE TABLE IF NOT EXISTS research_case_syntheses (
  id BIGSERIAL PRIMARY KEY,
  case_id TEXT NOT NULL REFERENCES research_cases(id) ON DELETE CASCADE,
  synthesis_version TEXT NOT NULL,
  external_research_run_id BIGINT REFERENCES external_research_runs(id) ON DELETE SET NULL,
  input_fingerprint TEXT NOT NULL,
  synthesis_payload JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT research_case_syntheses_input_key UNIQUE (case_id, synthesis_version, input_fingerprint)
);

-- migrate:split

CREATE INDEX IF NOT EXISTS research_case_syntheses_case_created_idx
  ON research_case_syntheses (case_id, created_at DESC, id DESC);
