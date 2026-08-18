const ACCENTS = [
  'var(--accent-1)',
  'var(--accent-2)',
  'var(--accent-3)',
  'var(--accent-4)',
  'var(--accent-5)',
];

export function getAccent(index) {
  return ACCENTS[index % ACCENTS.length];
}
