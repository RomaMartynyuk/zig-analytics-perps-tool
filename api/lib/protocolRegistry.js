import projects from '../../src/data/projects.json' with { type: 'json' };

/**
 * The projects config remains the only protocol registry. `metrics_key` is
 * needed only where an upstream adapter uses a different display name.
 */
export function getActiveProtocols() {
  return projects
    .filter((project) => project.is_active !== false)
    .map((project) => ({
      slug: project.defillama_slug,
      name: project.name,
      metricsKey: project.metrics_key || project.name,
      defillamaSlug: project.defillama_slug || null,
      isActive: true,
    }))
    .filter((project) => project.slug);
}
