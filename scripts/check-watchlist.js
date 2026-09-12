import { getResearchWatchlist } from '../server/researchWatchlistService.js';

const result = await getResearchWatchlist();
const requested = process.argv[2];
const entries = requested ? result.entries.filter((entry) => entry.case.id === requested || entry.case.protocol?.slug === requested) : result.entries;
console.log('RESEARCH WATCHLIST CHECK');
console.log(`CANONICAL DATE: ${result.canonicalDate || '—'}`);
console.log(`WATCHED CASES: ${result.summary.watchedCases}`);
for (const entry of entries) console.log(`\nCase: ${entry.case.id}\nProtocol: ${entry.case.protocol?.name || '—'}\nSeries: ${entry.currentState?.seriesKey || '—'}\nOriginal date: ${entry.originalState?.canonicalDate || entry.case.snapshotDate || '—'}\nOriginal lifecycle: ${entry.originalState?.lifecycle?.lifecycleState || '—'}\nPrevious watch evaluation: ${entry.previousWatchState?.canonicalDate || '—'}\nCurrent signal state: ${entry.currentState?.signalState || '—'}\nCurrent lifecycle: ${entry.currentState?.lifecycleState || '—'}\nCurrent score: ${entry.currentState?.score ?? '—'}\nCurrent strength: ${entry.currentState?.strengthValue ?? '—'} ${entry.currentState?.strengthMetric || ''}\nChange: ${entry.update?.type || entry.error || '—'}\nSignificance: ${entry.update?.significance || '—'}\nExplanation: ${entry.update?.explanation || '—'}`);
console.log(`\nSUMMARY\nWatched: ${result.summary.watchedCases}\nChanged: ${result.summary.changedCases}\nResolved: ${result.summary.resolved}\nReappeared: ${result.summary.reappeared}\nStrengthening: ${result.summary.strengthening}\nWeakening: ${result.summary.weakening}\nNot evaluable: ${result.summary.notEvaluable}`);
console.log(`\nPERSISTENCE\nRows reused: ${result.persistence.rowsReused}\nRows created: ${result.persistence.rowsCreated}\nDuration: ${result.persistence.durationMs}ms`);
