CREATE TABLE IF NOT EXISTS protocols (
  id BIGSERIAL PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- migrate:split

CREATE TABLE IF NOT EXISTS protocol_daily_snapshots (
  id BIGSERIAL PRIMARY KEY,
  protocol_id BIGINT NOT NULL REFERENCES protocols(id) ON DELETE CASCADE,
  snapshot_date DATE NOT NULL,
  captured_at TIMESTAMPTZ NOT NULL,
  volume_24h NUMERIC(38, 8),
  open_interest NUMERIC(38, 8),
  tvl NUMERIC(38, 8),
  markets_count INTEGER,
  data_source TEXT,
  source_updated_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT protocol_daily_snapshots_protocol_day_key UNIQUE (protocol_id, snapshot_date),
  CONSTRAINT protocol_daily_snapshots_volume_nonnegative CHECK (volume_24h IS NULL OR volume_24h >= 0),
  CONSTRAINT protocol_daily_snapshots_oi_nonnegative CHECK (open_interest IS NULL OR open_interest >= 0),
  CONSTRAINT protocol_daily_snapshots_tvl_nonnegative CHECK (tvl IS NULL OR tvl >= 0),
  CONSTRAINT protocol_daily_snapshots_markets_nonnegative CHECK (markets_count IS NULL OR markets_count >= 0)
);

-- migrate:split

CREATE INDEX IF NOT EXISTS protocol_daily_snapshots_date_idx
  ON protocol_daily_snapshots (snapshot_date);

-- migrate:split

CREATE INDEX IF NOT EXISTS protocol_daily_snapshots_protocol_date_idx
  ON protocol_daily_snapshots (protocol_id, snapshot_date DESC);
