import projects from '../data/projects.json';

// Some display names used elsewhere (e.g. api/derivatives.js's adapter
// registry) don't exactly match the "name" field in projects.json —
// bridge those known mismatches here so logo lookup still works.
const NAME_ALIASES = {
  grvt: 'Grvt',
  hotstuff: 'TradeHotStuff',
  risex: 'Rise',
};

const EXTRA_LOGO_SLUGS = {
  backpack: 'backpack',
};

function normalize(str) {
  return str.toLowerCase().replace(/[^a-z0-9]/g, '');
}

const slugByNormalizedName = {};
projects.forEach((p) => {
  slugByNormalizedName[normalize(p.name)] = p.defillama_slug;
});

/**
 * Resolves a project display name to its local logo file, served from
 * /public/logos/{slug}.png — uploaded manually (see logos/README in that
 * folder for the exact list), rather than pulled from a CDN, since CDN
 * coverage for these 20 (mostly new/niche) protocols was inconsistent.
 * Returns null if we don't have a defillama_slug for this name at all;
 * the actual file may still be missing — callers handle that with onError.
 */
export function getLogoUrl(name) {
  if (!name) return null;
  const norm = normalize(name);
  const resolvedName = NAME_ALIASES[norm] || name;
  const slug = EXTRA_LOGO_SLUGS[norm] || slugByNormalizedName[normalize(resolvedName)]; if (!slug) return null;
  return `/logos/${slug}.png`;
}