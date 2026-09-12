import { getSql } from './db.js';
import { snapshotDateKey } from './analyticsMath.js';
import { getSignalLifecycle, getObservationStrength, LIFECYCLE_CONFIG } from './signalLifecycleService.js';

const SIGNIFICANCE_WEIGHT = { HIGH: 4, MEDIUM: 3, LOW: 2, NONE: 1 };
const noChange = (type, explanation) => ({ changed: false, type, significance: 'NONE', explanation });

export function deriveWatchUpdate(previous, current) {
  if (!previous) return noChange('FIRST_CHECK', 'Monitoring baseline established.');
  if (previous.engineVersion !== current.engineVersion || previous.lifecycleVersion !== current.lifecycleVersion) return noChange('ENGINE_VERSION_CHANGED', 'Monitoring baseline reset because the Signal methodology changed.');
  if (current.signalState === 'NOT_EVALUABLE' && previous.signalState !== 'NOT_EVALUABLE') return { changed: true, type: 'BECAME_NOT_EVALUABLE', significance: 'MEDIUM', explanation: 'The watched pattern cannot be evaluated on the latest canonical snapshot.' };
  if (previous.signalState === 'NOT_EVALUABLE' && current.signalState !== 'NOT_EVALUABLE') return { changed: true, type: 'DATA_RESTORED', significance: 'MEDIUM', explanation: 'Required data is available again for this watched pattern.' };
  if (current.reappeared) return { changed: true, type: 'REAPPEARED', significance: 'HIGH', explanation: 'The pattern qualified again after an evaluable absence.' };
  if (current.lifecycleState === 'RESOLVED' && previous.lifecycleState !== 'RESOLVED') return { changed: true, type: 'RESOLVED', significance: 'HIGH', explanation: 'The pattern no longer qualifies under the current Signal Engine.' };
  if (previous.lifecycleState !== current.lifecycleState) return { changed: true, type: 'LIFECYCLE_CHANGED', significance: 'MEDIUM', explanation: `Lifecycle changed from ${previous.lifecycleState || 'unavailable'} to ${current.lifecycleState || 'unavailable'}.` };
  if (previous.strengthMetric && previous.strengthMetric === current.strengthMetric && Number.isFinite(previous.strengthValue) && Number.isFinite(current.strengthValue)) {
    const delta = current.strengthValue - previous.strengthValue;
    const threshold = /pp|share/.test(current.strengthMetric) ? LIFECYCLE_CONFIG.shareMaterialChangePp : Math.abs(previous.strengthValue) * LIFECYCLE_CONFIG.relativeMaterialChange;
    if (Math.abs(delta) >= threshold) return { changed: true, type: delta > 0 ? 'STRENGTH_INCREASED' : 'STRENGTH_DECREASED', significance: 'MEDIUM', explanation: `Signal strength ${delta > 0 ? 'increased' : 'decreased'} materially since the previous check.` };
  }
  return noChange('NO_MEANINGFUL_CHANGE', 'No meaningful change since the previous canonical evaluation.');
}

export function watchlistPriority(entry) {
  if (entry.update?.changed) return 600 + (SIGNIFICANCE_WEIGHT[entry.update.significance] || 0) * 10;
  if (['NEW','STRENGTHENING'].includes(entry.currentState?.lifecycleState)) return 500;
  if (entry.currentState?.lifecycleState === 'PERSISTING') return 400;
  if (entry.currentState?.signalState === 'NOT_EVALUABLE') return 100;
  return 200;
}

function evaluationFrom(history, lifecycle) {
  const observation = history.observations.at(-1);
  const strength = getObservationStrength(history.series.signalFamily, observation);
  return { canonicalDate: history.anchorDate, signalState: observation?.state || 'NOT_EVALUABLE', notEvaluableReason: observation?.notEvaluableReason || null, lifecycleState: lifecycle.lifecycleState, lifecycleConfidence: lifecycle.confidence, score: observation?.score ?? null, strengthValue: strength?.value ?? null, strengthMetric: strength?.metricKey ?? null, reappeared: lifecycle.flags.reappeared, engineVersion: lifecycle.engineVersion, lifecycleVersion: lifecycle.lifecycleVersion, seriesKey: history.series.key, checkedAt: new Date().toISOString() };
}

function rowEvaluation(row) { return row?.metadata_json ? { ...row.metadata_json, evaluationId: String(row.id), persistedAt: row.created_at } : null; }

async function persistEvaluation(sql, caseId, evaluation) {
  const rows = await sql.query(`INSERT INTO research_watch_evaluations (case_id,series_key,canonical_date,signal_state,lifecycle_state,lifecycle_confidence,score,strength_value,strength_metric,reappeared,engine_version,lifecycle_version,metadata_json)
    VALUES ($1,$2,$3::date,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13::jsonb)
    ON CONFLICT (case_id,canonical_date,engine_version,lifecycle_version) DO NOTHING
    RETURNING id,metadata_json,created_at`, [caseId,evaluation.seriesKey,evaluation.canonicalDate,evaluation.signalState,evaluation.lifecycleState,evaluation.lifecycleConfidence,evaluation.score,evaluation.strengthValue,evaluation.strengthMetric,evaluation.reappeared,evaluation.engineVersion,evaluation.lifecycleVersion,JSON.stringify(evaluation)]);
  if (rows[0]) return rowEvaluation(rows[0]);
  const existing = await sql.query(`SELECT id,metadata_json,created_at FROM research_watch_evaluations
    WHERE case_id=$1 AND canonical_date=$2::date AND engine_version=$3 AND lifecycle_version=$4 LIMIT 1`, [caseId,evaluation.canonicalDate,evaluation.engineVersion,evaluation.lifecycleVersion]);
  return rowEvaluation(existing[0]);
}

export async function getResearchWatchlist(sql = getSql()) {
  const started = Date.now();
  const [latestRows, watched] = await Promise.all([
    sql.query('SELECT MAX(snapshot_date)::text AS date FROM protocol_daily_snapshots'),
    sql.query(`SELECT c.id,c.case_payload,c.snapshot_date::text AS snapshot_date FROM research_case_statuses s JOIN research_cases c ON c.id=s.research_case_id WHERE s.status='WATCHING' ORDER BY c.snapshot_date DESC,c.id`),
  ]);
  const latestDate = snapshotDateKey(latestRows[0]?.date);
  if (!latestDate) throw new Error('No canonical snapshots are available for Watchlist evaluation');
  const entries = []; let rowsCreated = 0; let rowsReused = 0;
  for (const row of watched) {
    try {
      const [originalResult, currentResult, persistedRows] = await Promise.all([
        getSignalLifecycle({ caseId: row.id }, sql),
        getSignalLifecycle({ caseId: row.id, anchorDate: latestDate }, sql),
        sql.query('SELECT id,metadata_json,created_at FROM research_watch_evaluations WHERE case_id=$1 ORDER BY canonical_date DESC,id DESC LIMIT 3', [row.id]),
      ]);
      const currentComputed = evaluationFrom(currentResult.history, currentResult.lifecycle);
      const saved = persistedRows.map(rowEvaluation);
      const existingCurrent = saved.find((item) => item.canonicalDate === latestDate && item.engineVersion === currentComputed.engineVersion && item.lifecycleVersion === currentComputed.lifecycleVersion);
      const previous = saved.find((item) => item.canonicalDate !== latestDate || item.engineVersion !== currentComputed.engineVersion || item.lifecycleVersion !== currentComputed.lifecycleVersion) || null;
      const update = existingCurrent?.update || deriveWatchUpdate(previous, currentComputed);
      const currentState = existingCurrent || await persistEvaluation(sql, row.id, { ...currentComputed, update });
      if (existingCurrent) rowsReused += 1; else rowsCreated += 1;
      const lastChangeRows = await sql.query(`SELECT metadata_json,created_at FROM research_watch_evaluations WHERE case_id=$1 AND metadata_json->'update'->>'changed'='true' ORDER BY canonical_date DESC,id DESC LIMIT 1`, [row.id]);
      const payload = row.case_payload;
      entries.push({
        case: { id: row.id, protocol: payload.protocol, headline: payload.case.headline, snapshotDate: row.snapshot_date, originalScore: payload.case.score, originalSeverity: payload.case.severity, status: 'WATCHING' },
        originalState: { canonicalDate: originalResult.history.anchorDate, signalState: originalResult.history.observations.at(-1)?.state || 'NOT_EVALUABLE', lifecycle: originalResult.lifecycle },
        previousWatchState: previous, currentState, update,
        lastMeaningfulChange: lastChangeRows[0] ? { ...lastChangeRows[0].metadata_json.update, canonicalDate: lastChangeRows[0].metadata_json.canonicalDate, detectedAt: lastChangeRows[0].created_at } : null,
        metadata: { engineVersion: currentComputed.engineVersion, lifecycleVersion: currentComputed.lifecycleVersion, lastCheckedAt: currentState.checkedAt },
      });
    } catch (error) {
      entries.push({ case: { id: row.id, protocol: row.case_payload?.protocol, headline: row.case_payload?.case?.headline, snapshotDate: row.snapshot_date, status: 'WATCHING' }, error: 'WATCH_EVALUATION_UNAVAILABLE' });
      console.error('Watch evaluation failed', { caseId: row.id, error: error.message });
    }
  }
  entries.sort((a,b)=>watchlistPriority(b)-watchlistPriority(a)||(b.case.originalScore||0)-(a.case.originalScore||0));
  const changed = entries.filter((entry) => entry.update?.changed);
  return { canonicalDate: latestDate, summary: { watchedCases: entries.length, changedCases: changed.length, reappeared: changed.filter((entry)=>entry.update.type==='REAPPEARED').length, strengthening: entries.filter((entry)=>entry.currentState?.lifecycleState==='STRENGTHENING').length, weakening: entries.filter((entry)=>entry.currentState?.lifecycleState==='WEAKENING').length, resolved: entries.filter((entry)=>entry.currentState?.lifecycleState==='RESOLVED').length, notEvaluable: entries.filter((entry)=>entry.currentState?.signalState==='NOT_EVALUABLE').length }, entries, persistence: { rowsReused, rowsCreated, durationMs: Date.now()-started } };
}
