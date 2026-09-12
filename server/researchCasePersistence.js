import { getSql } from './db.js';
import { snapshotDateKey } from './analyticsMath.js';

export const RESEARCH_CASE_PAYLOAD_VERSION = 1;
export const RESEARCH_CASE_ID_PATTERN = /^research:\d{4}-\d{2}-\d{2}:[a-z0-9._-]+:[a-z0-9_-]+$/i;

export function validResearchCaseId(value) {
  return typeof value === 'string' && RESEARCH_CASE_ID_PATTERN.test(value);
}

function safePayload(value) {
  const encoded = JSON.stringify(value, (_key, item) => {
    if (typeof item === 'number' && !Number.isFinite(item)) throw new Error('Research Case payload contains a non-finite number');
    return item === undefined ? null : item;
  });
  if (!encoded) throw new Error('Research Case payload is not serializable');
  return JSON.parse(encoded);
}

export function createPersistedCaseRecord(detail) {
  const id = detail?.case?.id;
  const snapshotDate = snapshotDateKey(detail?.snapshot?.date || detail?.case?.snapshotDate);
  const protocolId = Number(detail?.protocol?.id);
  if (!validResearchCaseId(id) || !snapshotDate || !Number.isInteger(protocolId) || protocolId <= 0 || !detail?.protocol?.slug || !detail?.case?.family) throw new Error('Invalid Research Case persistence payload');
  const { status: _mutableStatus, ...immutableCase } = detail.case;
  const immutableDetail = safePayload({ ...detail, case: immutableCase, caseSource: 'PERSISTED', casePayloadVersion: RESEARCH_CASE_PAYLOAD_VERSION });
  return {
    id, protocolId, protocolSlug: detail.protocol.slug, snapshotDate,
    signalFamily: detail.case.family, headline: detail.case.headline,
    score: detail.case.score, severity: detail.case.severity, period: detail.case.period,
    payloadVersion: RESEARCH_CASE_PAYLOAD_VERSION, payload: immutableDetail,
  };
}

export async function persistResearchCases(details, sql = getSql()) {
  const records = []; const rejected = [];
  for (const detail of details) {
    try { records.push(createPersistedCaseRecord(detail)); }
    catch (error) { rejected.push({ id: detail?.case?.id || null, error: error.message }); }
  }
  if (records.length) {
    await sql.query(`INSERT INTO research_cases
      (id, protocol_id, protocol_slug, snapshot_date, signal_family, headline, score, severity, period, payload_version, case_payload)
      SELECT x.id, x.protocol_id, x.protocol_slug, x.snapshot_date, x.signal_family, x.headline, x.score, x.severity, x.period, x.payload_version, x.case_payload
      FROM jsonb_to_recordset($1::jsonb) AS x(id text, protocol_id bigint, protocol_slug text, snapshot_date date, signal_family text, headline text, score numeric, severity text, period text, payload_version integer, case_payload jsonb)
      ON CONFLICT (id) DO NOTHING`, [JSON.stringify(records.map((item) => ({ id: item.id, protocol_id: item.protocolId, protocol_slug: item.protocolSlug, snapshot_date: item.snapshotDate, signal_family: item.signalFamily, headline: item.headline, score: item.score, severity: item.severity, period: item.period, payload_version: item.payloadVersion, case_payload: item.payload })))]);
  }
  return { attempted: details.length, valid: records.length, rejected };
}

export async function getPersistedResearchCase(caseId, sql = getSql()) {
  if (!validResearchCaseId(caseId)) return null;
  try {
    const rows = await sql.query(`SELECT c.case_payload, c.payload_version, c.snapshot_date::text AS snapshot_date, s.status
      FROM research_cases c LEFT JOIN research_case_statuses s ON s.research_case_id = c.id
      WHERE c.id = $1 LIMIT 1`, [caseId]);
    if (!rows.length) return null;
    const payload = safePayload(rows[0].case_payload);
    return {
      ...payload,
      case: { ...payload.case, status: rows[0].status || null },
      snapshot: { ...payload.snapshot, date: snapshotDateKey(rows[0].snapshot_date) || payload.snapshot?.date },
      caseSource: 'PERSISTED', casePayloadVersion: Number(rows[0].payload_version),
    };
  } catch (error) {
    if (/does not exist|undefined table|relation/i.test(error.message || '')) return null;
    throw error;
  }
}
