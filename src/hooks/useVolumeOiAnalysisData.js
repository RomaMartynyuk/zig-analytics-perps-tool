import { useEffect, useState } from 'react';

export function useVolumeOiAnalysisData() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    async function load() {
      setLoading(true);
      setError(null);
      try {
        const response = await fetch('/api/analytics/volume-oi', { signal: controller.signal });
        if (!response.ok) throw new Error('Volume/OI analysis request failed');
        setData(await response.json());
      } catch (requestError) {
        if (requestError.name !== 'AbortError') setError(requestError);
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }
    load();
    return () => controller.abort();
  }, [reloadKey]);

  return { data, loading, error, refetch: () => setReloadKey((key) => key + 1) };
}
