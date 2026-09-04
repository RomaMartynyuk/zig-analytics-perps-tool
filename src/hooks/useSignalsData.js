import { useEffect, useState } from 'react';

export function useSignalsData(period, category) {
  const [data, setData] = useState(null); const [loading, setLoading] = useState(true); const [error, setError] = useState(null); const [reloadKey, setReloadKey] = useState(0);
  useEffect(() => { const controller = new AbortController(); (async () => { setLoading(true); setError(null); try { const response = await fetch(`/api/analytics/signals?${new URLSearchParams({ period, category, limit: '8' })}`, { signal: controller.signal }); if (!response.ok) throw new Error(); setData(await response.json()); } catch (err) { if (err.name !== 'AbortError') setError(err); } finally { if (!controller.signal.aborted) setLoading(false); } })(); return () => controller.abort(); }, [period, category, reloadKey]);
  return { data, loading, error, refetch: () => setReloadKey((key) => key + 1) };
}
