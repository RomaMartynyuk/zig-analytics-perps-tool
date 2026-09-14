import { getSql } from '../server/db.js';
import { validResearchCaseId } from '../server/researchCasePersistence.js';
import { getResearchCaseTimeline } from '../server/researchTimelineService.js';

const sql=getSql();const requested=process.argv[2]||'lighter';let caseId=requested;
if(!validResearchCaseId(caseId)){const rows=await sql.query('SELECT id FROM research_cases WHERE protocol_slug=$1 ORDER BY snapshot_date DESC,score DESC,id LIMIT 1',[requested]);caseId=rows[0]?.id;}
if(!caseId)throw new Error(`No persisted Research Case found for ${requested}`);
const result=await getResearchCaseTimeline({caseId},sql);console.log('RESEARCH CASE TIMELINE CHECK');
console.log(`\nCASE\nCase ID: ${result.case.id}\nProtocol: ${result.case.protocol.name}\nHeadline: ${result.case.headline}\nCase Snapshot: ${result.case.snapshotDate}\nSeries: ${result.series.key}`);
console.log(`\nCURRENT FOLLOW-UP\nLatest Canonical: ${result.currentFollowUp.canonicalDate}\nSignal State: ${result.currentFollowUp.signalState}\nLifecycle: ${result.currentFollowUp.lifecycleState||'UNAVAILABLE'}\nConfidence: ${result.currentFollowUp.lifecycleConfidence||'—'}`);
console.log('\nTIMELINE\nDate | Category | Event | Significance | Summary | Sources');for(const item of result.events)console.log(`${item.effectiveDate} | ${item.category} | ${item.eventType} | ${item.significance} | ${item.summary} | ${item.references.map((reference)=>reference.type).join('+')||item.source}`);
console.log(`\nSUMMARY\nEvents: ${result.summary.events}\nSignal events: ${result.summary.signalEvents}\nLifecycle events: ${result.summary.lifecycleEvents}\nResearch events: ${result.summary.researchEvents}\nSynthesis events: ${result.summary.synthesisEvents}\nWatch events: ${result.summary.watchEvents}\nStatus events: ${result.summary.statusEvents}\nMerged events: ${result.summary.mergedEvents}\nSuppressed duplicate/noise events: ${result.summary.suppressedDuplicateOrNoiseEvents}`);
console.log(`\nVERSIONS\nSignal Engine: ${result.versions.signalEngine}\nLifecycle: ${result.versions.lifecycle}\nTimeline: ${result.versions.timeline}`);
console.log(`\nPERFORMANCE\nDB queries: ${result.performance.dbQueries}\nDuration: ${result.performance.durationMs}ms`);
