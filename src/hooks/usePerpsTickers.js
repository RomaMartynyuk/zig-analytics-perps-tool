import { useEffect, useState } from 'react';

export function usePerpsTickers() {
  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    let active = true;

    async function load() {
      try {
        const response = await fetch('/api/tickers');
        if (!response.ok) throw new Error('Failed to load CoinGecko tickers');
        const payload = await response.json();
        if (active) setData(Array.isArray(payload?.tickers) ? payload.tickers : []);
      } catch (err) {
        if (active) setError(err);
      } finally {
        if (active) setLoading(false);
      }
    }

    load();
    return () => { active = false; };
  }, []);

  return { data, loading, error };
}
