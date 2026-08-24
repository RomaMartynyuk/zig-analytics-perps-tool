export function formatUSD(value) {
  if (value == null) return '—';
  if (value >= 1_000_000_000) return `$${(value / 1_000_000_000).toFixed(1)}B`;
  if (value >= 1_000_000) return `$${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `$${(value / 1_000).toFixed(0)}K`;
  return `$${value.toFixed(0)}`;
}

export function formatStatUSD(value) {
  if (value == null) return '—';
  if (value >= 1_000_000_000) return `$${(value / 1_000_000_000).toFixed(3)}b`;
  if (value >= 1_000_000) return `$${(value / 1_000_000).toFixed(2)}m`;
  if (value >= 1_000) return `$${(value / 1_000).toFixed(1)}k`;
  return `$${value.toFixed(0)}`;
}

export function formatPercent(value) {
  if (value == null) return '—';
  const sign = value > 0 ? '+' : '';
  return `${sign}${value.toFixed(1)}%`;
}

export function formatTokenPrice(value) {
  if (value == null || !Number.isFinite(value)) return '—';
  if (value >= 1) return `$${value.toFixed(2)}`;
  if (value >= 0.01) return `$${value.toFixed(4)}`;
  return `$${value.toFixed(6)}`;
}

export const POINTS_STATUS_LABELS = {
  live: 'Points Live',
  not_live: 'Not Live',
  retro_confirmed: 'Retro Confirmed',
  running: 'Points Running',
  watch: 'Watch',
  late_stage: 'Late Stage',
};
