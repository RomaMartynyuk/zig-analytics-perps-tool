-- Shared singleton lease prevents separate hosts collecting the same tape.
-- Checkpoints/identities NEVER go into this table.
CREATE TABLE IF NOT EXISTS participation_worker_leases (
  name TEXT PRIMARY KEY,
  owner UUID NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
