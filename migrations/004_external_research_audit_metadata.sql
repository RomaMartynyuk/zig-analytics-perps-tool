ALTER TABLE external_research_runs
  ADD COLUMN IF NOT EXISTS signal_family TEXT,
  ADD COLUMN IF NOT EXISTS signal_type TEXT,
  ADD COLUMN IF NOT EXISTS case_headline TEXT,
  ADD COLUMN IF NOT EXISTS protocol_slug TEXT,
  ADD COLUMN IF NOT EXISTS protocol_name TEXT,
  ADD COLUMN IF NOT EXISTS query_count INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS result_count INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS suppressed_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS case_reference_json JSONB NOT NULL DEFAULT '{}'::jsonb;

-- migrate:split

CREATE INDEX IF NOT EXISTS external_research_runs_cache_idx
  ON external_research_runs (case_id, window_key, research_version, status, created_at DESC);
