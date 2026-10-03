export const LIGHTER_POINTS_PER_WEEK = 65_000;
export const LIGHTER_TOKEN_ALLOCATION = 11_000_000;

export function calculateLighterRobinhood({ litPrice, weeks, personalPoints = '' }) {
  const price = typeof litPrice === 'number' ? litPrice : Number(litPrice);
  const duration = Number(weeks);
  const validPrice = litPrice != null && litPrice !== '' && Number.isFinite(price) && price > 0;
  const validDuration = Number.isInteger(duration) && duration >= 4 && duration <= 60;
  if (!validPrice || !validDuration) return { campaignValue: null, pointPrice: null, personalAllocation: null };
  const campaignValue = LIGHTER_TOKEN_ALLOCATION * price;
  if (!Number.isFinite(campaignValue)) return { campaignValue: null, pointPrice: null, personalAllocation: null };
  const pointPrice = campaignValue / (LIGHTER_POINTS_PER_WEEK * duration);
  const owned = personalPoints === '' || personalPoints == null ? null : Number(personalPoints);
  const rawAllocation = owned != null && Number.isFinite(owned) && owned >= 0 ? owned * pointPrice : null;
  const personalAllocation = rawAllocation != null && Number.isFinite(rawAllocation) ? rawAllocation : null;
  return { campaignValue, pointPrice, personalAllocation };
}
