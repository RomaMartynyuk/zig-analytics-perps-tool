import { useEffect, useState } from 'react';

export function useParticipationData(period) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [reload, setReload] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    fetch(`/api/analytics/concentration?${new URLSearchParams({ view: 'participation', period })}`, { signal: controller.signal })
      .then((response) => { if (!response.ok) throw new Error('Participation request failed'); return response.json(); })
      .then((value) => { if (!controller.signal.aborted) setData(value); })
      .catch((requestError) => { if (!controller.signal.aborted) setError(requestError); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [period, reload]);
  return { data, loading, error, refetch: () => setReload((value) => value + 1) };
}
