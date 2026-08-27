import { useEffect, useState } from 'react';

export function useMarketShareData(metric, period) {
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
        const query = new URLSearchParams({ metric, period });
        const response = await fetch(`/api/analytics/market-share?${query}`, { signal: controller.signal });
        if (!response.ok) throw new Error('Market share request failed');
        setData(await response.json());
      } catch (requestError) {
        if (requestError.name !== 'AbortError') setError(requestError);
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }
    load();
    return () => controller.abort();
  }, [metric, period, reloadKey]);

  return { data, loading, error, refetch: () => setReloadKey((key) => key + 1) };
}
