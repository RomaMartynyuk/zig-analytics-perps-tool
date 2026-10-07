import { getConfiguredProtocols } from './protocolRegistry.js';
import { collectN1Participation } from './n1ParticipationAdapter.js';
import { collectArcusParticipation } from './arcusParticipationAdapter.js';
import { collectLighterParticipation } from './lighterParticipationAdapter.js';
import { participationUnavailableReason } from './participationCapabilities.js';

// Adapter dispatch is keyed by stable slugs; protocol universe stays in registry.
const ADAPTERS = { '01-exchange': collectN1Participation, arcus: collectArcusParticipation, lighter: collectLighterParticipation };
export const getParticipationAdapterSlugs = () => Object.keys(ADAPTERS);
export async function collectParticipation({ protocols = getConfiguredProtocols(), adapters = ADAPTERS, onResult = async () => {}, ...options } = {}) {
  const summary = { saved: [], partial: [], failed: [], unavailable: [], unavailableReasons: {} };
  for (const protocol of protocols.filter((item) => item.isActive)) {
    const adapter = adapters[protocol.slug];
    if (!adapter) { summary.unavailable.push(protocol.slug); summary.unavailableReasons[protocol.slug] = participationUnavailableReason(protocol.slug); continue; }
    try {
      const result = await adapter(options);
      await onResult(protocol, result);
      summary[result.complete ? 'saved' : 'partial'].push({ slug: protocol.slug, complete: result.complete, diagnostics: result.diagnostics });
    } catch (error) {
      summary.failed.push({ slug: protocol.slug, error: String(error?.message || error) });
    }
  }
  return summary;
}
