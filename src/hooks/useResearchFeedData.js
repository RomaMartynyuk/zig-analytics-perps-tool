import { useEffect, useState } from 'react';

export function useResearchFeedData(status) {
  const [data, setData] = useState(null); const [loading, setLoading] = useState(true); const [error, setError] = useState(null); const [reloadKey, setReloadKey] = useState(0);
  useEffect(() => { const controller = new AbortController(); (async () => { setLoading(true); setError(null); try { const response = await fetch(`/api/research/feed?${new URLSearchParams({ limit: '5', status })}`, { signal: controller.signal }); if (!response.ok) throw new Error(); setData(await response.json()); } catch (err) { if (err.name !== 'AbortError') setError(err); } finally { if (!controller.signal.aborted) setLoading(false); } })(); return () => controller.abort(); }, [status, reloadKey]);
  return { data, loading, error, refetch: () => setReloadKey((key) => key + 1) };
}

export async function setResearchCaseStatus(caseId, status) {
  const response = await fetch('/api/research/feed', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ caseId, status }) });
  if (!response.ok) throw new Error('Unable to update research status');
  return response.json();
}

export async function runExternalCaseResearch(caseId, window, refresh = false) {
  const response = await fetch('/api/research/feed', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'external-research', caseId, window, refresh }) });
  if (!response.ok) { const body = await response.json().catch(() => ({})); throw new Error(body.error || 'External research is temporarily unavailable'); }
  return response.json();
}

export function useResearchCaseData(caseId) {
  const [data, setData] = useState(null); const [loading, setLoading] = useState(true); const [error, setError] = useState(null); const [reloadKey, setReloadKey] = useState(0);
  useEffect(() => { if (!caseId) return undefined; const controller = new AbortController(); (async () => { setLoading(true); setError(null); try { const response = await fetch(`/api/research/feed?${new URLSearchParams({ caseId })}`, { signal: controller.signal }); if (response.status === 404) { setError('not-found'); return; } if (!response.ok) throw new Error(); setData(await response.json()); } catch (err) { if (err.name !== 'AbortError') setError('unavailable'); } finally { if (!controller.signal.aborted) setLoading(false); } })(); return () => controller.abort(); }, [caseId, reloadKey]);
  return { data, loading, error, refetch: () => setReloadKey((key) => key + 1) };
}
