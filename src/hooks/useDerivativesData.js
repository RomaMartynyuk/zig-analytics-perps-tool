import { useEffect, useState } from 'react';

/**
 * Loads aggregate Perp Volume (24h/7d/30d) and Open Interest across the
 * tracked-project list, via our own /api/derivatives proxy (see
 * api/derivatives.js — same CORS reasoning as the TVL proxy).
 */
export function useDerivativesData() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/derivatives');
      if (!res.ok) throw new Error('Failed to load derivatives data');
      setData(await res.json());
    } catch (err) {
      setError(err);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  return { data, loading, error, refetch: load };
}
