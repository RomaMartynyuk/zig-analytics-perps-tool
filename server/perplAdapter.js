const BASE = 'https://app.perpl.xyz/api';

function valid(value) {
  if (value == null || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : null;
}

/** Perpl's context state uses scaled integers. `dva` is a daily collateral
 * amount; `oi` is base size; `mrk` is a price. Decimals come from context. */
export function normalizePerplContext(context) {
  const markets = Array.isArray(context?.markets) ? context.markets : [];
  const instances = new Map((context?.instances || []).map((item) => [item.id, item]));
  const tokens = new Map((context?.tokens || []).map((item) => [item.id, item]));
  const seen = new Set();
  let volume = 0, openInterest = 0, volumeComplete = true, oiComplete = true, marketsCount = 0;
  for (const market of markets) {
    if (market?.config?.is_open !== true || market.perpetual_id == null || seen.has(market.id)) continue;
    seen.add(market.id);
    marketsCount += 1;
    const token = tokens.get(instances.get(market.instance_id)?.collateral_token_id);
    const decimals = token?.decimals;
    const sizeDecimals = market.config.size_decimals;
    const priceDecimals = market.config.price_decimals;
    const rawVolume = valid(market.state?.dva);
    const rawOi = valid(market.state?.oi);
    const rawMark = valid(market.state?.mrk);
    if (rawVolume == null || !Number.isInteger(decimals) || decimals < 0 || decimals > 18) volumeComplete = false;
    else volume += rawVolume / 10 ** decimals;
    if (rawOi == null || rawMark == null || !Number.isInteger(sizeDecimals) || !Number.isInteger(priceDecimals) || sizeDecimals < 0 || priceDecimals < 0 || sizeDecimals > 18 || priceDecimals > 18) oiComplete = false;
    else openInterest += (rawOi / 10 ** sizeDecimals) * (rawMark / 10 ** priceDecimals);
  }
  return { volume: marketsCount && volumeComplete ? volume : null, openInterest: marketsCount && oiComplete ? openInterest : null, marketsCount: marketsCount || null };
}

export async function fetchPerplMarketMetrics(fetchJson) {
  return normalizePerplContext(await fetchJson(`${BASE}/v1/pub/context`));
}
