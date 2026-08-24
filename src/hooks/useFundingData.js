import { useCallback, useEffect, useState } from 'react';

export function useFundingData() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch('/api/funding');
      if (!response.ok) throw new Error('Failed to load funding data');
      setData(await response.json());
    } catch (err) {
      setError(err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    const interval = setInterval(load, 60_000);
    return () => clearInterval(interval);
  }, [load]);

  return { markets: data?.markets || [], updatedAt: data?.updatedAt, loading, error, refetch: load };
}
