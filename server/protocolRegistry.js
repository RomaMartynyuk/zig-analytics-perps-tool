// Server-only configured protocol registry.
import projects from '../src/data/projects.json' with { type: 'json' };

/**
 * The projects config remains the only protocol registry. `metrics_key` is
 * needed only where an upstream adapter uses a different display name.
 */
export function getConfiguredProtocols() {
  return projects
    .map((project) => ({
      slug: project.defillama_slug,
      name: project.name,
      metricsKey: project.metrics_key || project.name,
      defillamaSlug: project.defillama_slug || null,
      isActive: project.is_active !== false,
    }))
    .filter((project) => project.slug);
}

export function getActiveProtocols() {
  return getConfiguredProtocols().filter((project) => project.isActive);
}
