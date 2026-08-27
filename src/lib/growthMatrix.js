export function growthSortValue(protocol, key) {
  const cell = protocol?.[key];
  return key === 'volumeShare' ? cell?.changePp : cell?.growthPct;
}

export function sortGrowthRows(rows, key, descending = true) {
  return (Array.isArray(rows) ? rows : []).slice().sort((leftProtocol, rightProtocol) => {
    const left = growthSortValue(leftProtocol, key);
    const right = growthSortValue(rightProtocol, key);
    if (!Number.isFinite(left) && !Number.isFinite(right)) return String(leftProtocol?.name || '').localeCompare(String(rightProtocol?.name || ''));
    if (!Number.isFinite(left)) return 1;
    if (!Number.isFinite(right)) return -1;
    return descending ? right - left : left - right;
  });
}
