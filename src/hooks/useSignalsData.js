import { useEffect, useState } from 'react';

export function useSignalsData(period, category) {
  const [data, setData] = useState(null); const [loading, setLoading] = useState(true); const [error, setError] = useState(null);
  useEffect(() => { const controller = new AbortController(); (async () => { setLoading(true); setError(null); try { const response = await fetch(`/api/analytics/signals?${new URLSearchParams({ period, category, limit: '8' })}`, { signal: controller.signal }); if (!response.ok) throw new Error(); setData(await response.json()); } catch (err) { if (err.name !== 'AbortError') setError(err); } finally { if (!controller.signal.aborted) setLoading(false); } })(); return () => controller.abort(); }, [period, category]);
  return { data, loading, error };
}
