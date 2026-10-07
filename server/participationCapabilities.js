// Source capability descriptions, NOT a second tracked-protocol registry.
export function participationUnavailableReason(slug) {
  if (slug === 'variational') return 'Variational currently documents aggregate market stats only. No public global execution tape with participant identities or complete account-volume distribution is available; participant count and concentration cannot be derived from Volume/OI.';
  if (slug === 'arcus' || slug === 'lighter') return 'Official public trade adapter available. A complete frozen UTC-day collection and same-window volume reconciliation are required before concentration is published.';
  return 'Participant data has not been collected for this protocol.';
}
