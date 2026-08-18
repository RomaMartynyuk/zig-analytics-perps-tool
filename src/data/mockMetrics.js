import projects from './projects.json';

// Simple deterministic hash so the same project always gets the same
// placeholder numbers across reloads (no jarring random flicker).
function seededValue(seed, min, max) {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) {
    hash = (hash << 5) - hash + seed.charCodeAt(i);
    hash |= 0;
  }
  const normalized = (Math.abs(hash) % 1000) / 1000;
  return min + normalized * (max - min);
}

export const statCards = [
  { label: 'Perp Volume (24h)', value: 5.728e9, change: -0.22 },
  { label: 'Perp Volume (7d)', value: 95.311e9, change: 1.84 },
  { label: 'Perp Volume (30d)', value: 480.48e9, change: 4.12 },
  { label: 'Open Interest', value: 17.107e9, change: -1.05 },
];

export const perpVolumeRanking = projects
  .map((p, i) => ({
    ...p,
    value: seededValue(p.name + 'vol', 2e6, 210e6),
  }))
  .sort((a, b) => b.value - a.value);

export const openInterestRanking = projects
  .map((p, i) => ({
    ...p,
    value: seededValue(p.name + 'oi', 1e6, 90e6),
  }))
  .sort((a, b) => b.value - a.value);

export const upcomingSnapshots = projects
  .filter((p) => p.points_status === 'live' || p.points_status === 'running')
  .map((p) => ({
    ...p,
    days: Math.floor(seededValue(p.name + 'd', 0, 7)),
    hours: Math.floor(seededValue(p.name + 'h', 0, 23)),
    minutes: Math.floor(seededValue(p.name + 'm', 0, 59)),
  }));

export const lastTickers = projects.map((p) => ({
  ...p,
  ticker: '$' + p.name.slice(0, 4).toUpperCase(),
  price: seededValue(p.name + 'price', 0.4, 45),
  change: seededValue(p.name + 'chg', -8, 12),
}));
