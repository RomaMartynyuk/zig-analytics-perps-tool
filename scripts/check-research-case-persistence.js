import { getSql } from '../server/db.js';
import { getDailyResearchFeed } from '../server/researchFeedService.js';
import { getPersistedResearchCase, RESEARCH_CASE_PAYLOAD_VERSION } from '../server/researchCasePersistence.js';

const sql = getSql();
const feed = await getDailyResearchFeed({ limit: 3, status: 'all' }, sql);
if (!feed.cases.length) throw new Error('No current Daily Research Feed cases are available to persist.');

console.log('RESEARCH CASE PERSISTENCE CHECK');
console.log(`Snapshot: ${feed.snapshotDate}`);
console.log(`Payload version: ${RESEARCH_CASE_PAYLOAD_VERSION}`);

for (const item of feed.cases) {
  const persisted = await getPersistedResearchCase(item.id, sql);
  if (!persisted) throw new Error(`Case was not persisted: ${item.id}`);
  const checks = {
    id: persisted.case.id === item.id,
    snapshotDate: persisted.snapshot.date === item.snapshotDate,
    score: persisted.case.score === item.score,
    family: persisted.case.family === item.family,
    primarySignal: persisted.case.primarySignal?.id === item.primarySignal?.id,
    payloadVersion: persisted.casePayloadVersion === RESEARCH_CASE_PAYLOAD_VERSION,
  };
  if (Object.values(checks).some((value) => !value)) throw new Error(`Persisted read-back mismatch for ${item.id}: ${JSON.stringify(checks)}`);
  const evidence = persisted.case.evidence?.map((entry) => `${entry.label}: ${entry.formatted}`).join(' · ') || 'No formatted evidence';
  console.log(JSON.stringify({ caseId: item.id, protocol: item.protocol.name, family: item.family, snapshotDate: item.snapshotDate, score: item.score, primaryEvidence: evidence, payloadVersion: persisted.casePayloadVersion, status: 'PERSISTED_AND_VERIFIED' }));
}
