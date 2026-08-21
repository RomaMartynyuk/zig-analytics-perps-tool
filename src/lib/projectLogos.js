import projects from '../data/projects.json';

// Some display names used elsewhere (e.g. api/derivatives.js's adapter
// registry) don't exactly match the "name" field in projects.json —
// bridge those known mismatches here so logo lookup still works.
const NAME_ALIASES = {
  grvt: 'Grvt',
  hotstuff: 'TradeHotStuff',
  risex: 'Rise',
};

function normalize(str) {
  return str.toLowerCase().replace(/[^a-z0-9]/g, '');
}

const slugByNormalizedName = {};
projects.forEach((p) => {
  slugByNormalizedName[normalize(p.name)] = p.defillama_slug;
});

/**
 * Resolves a project display name to a DefiLlama icon CDN URL, or null if
 * we don't have a defillama_slug for it. The icon may still 404 (not every
 * protocol has an icon there) — callers should handle that with onError.
 */
export function getLogoUrl(name) {
  if (!name) return null;
  const norm = normalize(name);
  const resolvedName = NAME_ALIASES[norm] || name;
  const slug = slugByNormalizedName[normalize(resolvedName)];
  if (!slug) return null;
  return `https://icons.llamao.fi/icons/protocols/${slug}.png`;
}
