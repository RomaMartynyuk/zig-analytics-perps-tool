// Vercel Serverless Function — runs server-side, so it isn't subject to
// browser CORS restrictions the way a client-side fetch to api.llama.fi is.
// GET /api/tvl?slug=variational -> proxies https://api.llama.fi/protocol/variational
export default async function handler(req, res) {
  const { slug } = req.query;

  if (!slug || Array.isArray(slug)) {
    return res.status(400).json({ error: 'Missing or invalid slug' });
  }

  try {
    const upstream = await fetch(`https://api.llama.fi/protocol/${encodeURIComponent(slug)}`);

    if (!upstream.ok) {
      return res.status(upstream.status).json({ error: 'Not found on DefiLlama' });
    }

    const data = await upstream.json();

    // Cache at the edge for 30 min — TVL doesn't need to be second-fresh,
    // and this keeps us well within DefiLlama's free-tier fair use.
    res.setHeader('Cache-Control', 's-maxage=1800, stale-while-revalidate=3600');
    return res.status(200).json(data);
  } catch (err) {
    return res.status(502).json({ error: 'Upstream fetch failed' });
  }
}
