CREATE TABLE IF NOT EXISTS external_research_runs (
  id BIGSERIAL PRIMARY KEY,
  case_id TEXT NOT NULL,
  protocol_id BIGINT NOT NULL REFERENCES protocols(id) ON DELETE RESTRICT,
  snapshot_date DATE NOT NULL,
  window_start DATE NOT NULL,
  window_end DATE NOT NULL,
  window_key TEXT NOT NULL,
  research_version TEXT NOT NULL DEFAULT 'v1',
  status TEXT NOT NULL CHECK (status IN ('PENDING', 'RUNNING', 'COMPLETED', 'PARTIAL', 'FAILED')),
  provider TEXT,
  queries_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  summary_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ
);

-- migrate:split

CREATE INDEX IF NOT EXISTS external_research_runs_case_window_idx
  ON external_research_runs (case_id, window_key, created_at DESC);

-- migrate:split

CREATE TABLE IF NOT EXISTS external_research_findings (
  id BIGSERIAL PRIMARY KEY,
  research_run_id BIGINT NOT NULL REFERENCES external_research_runs(id) ON DELETE CASCADE,
  category TEXT NOT NULL,
  title TEXT NOT NULL,
  source_type TEXT NOT NULL,
  source_name TEXT,
  url TEXT NOT NULL,
  published_at TIMESTAMPTZ,
  event_date DATE,
  summary TEXT NOT NULL,
  possible_relevance TEXT,
  relevance_score NUMERIC(5, 2) NOT NULL,
  confidence TEXT NOT NULL CHECK (confidence IN ('HIGH', 'MEDIUM', 'LOW')),
  temporal_distance_days INTEGER,
  supporting_sources_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  metadata_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT external_research_findings_url_key UNIQUE (research_run_id, url)
);

-- migrate:split

CREATE INDEX IF NOT EXISTS external_research_findings_run_relevance_idx
  ON external_research_findings (research_run_id, relevance_score DESC);
