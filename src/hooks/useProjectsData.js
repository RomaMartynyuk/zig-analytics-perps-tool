import { useEffect, useState } from 'react';
import projects from '../data/projects.json';
import { fetchAllProjectsTVL } from '../lib/defillama';

/**
 * Loads live TVL data for every tracked project on mount.
 * Returns { projects, loading, error, refetch } — projects is always the
 * full config list, each entry augmented with `tvlData` (or null on miss).
 */
export function useProjectsData() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const merged = await fetchAllProjectsTVL(projects);
      setData(merged);
    } catch (err) {
      setError(err);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  return { projects: data, loading, error, refetch: load };
}
