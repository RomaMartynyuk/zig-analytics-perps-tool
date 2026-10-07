import { useState } from 'react';
import { formatUSD } from '../lib/format';
import { useParticipationData } from '../hooks/useParticipationData';
import AnalyticsCredit from './AnalyticsCredit';

const percent = (value) => Number.isFinite(value) ? `${value.toFixed(1)}%` : '—';
const money = (value) => Number.isFinite(value) ? formatUSD(value) : '—';
const preciseMoney = (value) => Number.isFinite(value) ? new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 2 }).format(value) : 'Unavailable';
const participantLabel = (type) => ({ ACCOUNT: 'Trading accounts', ADDRESS: 'Trading addresses', SUBACCOUNT: 'Trading subaccounts', UNKNOWN: 'Unavailable' })[type] || 'Unavailable';

function ObservationTable({ rows, onSelect }) {
  return <div className="participation-scroll"><table><thead><tr><th>DEX</th><th>Attributed Volume</th><th>Participants</th><th>Mean</th><th>Median</th><th>Top 5</th><th>Top 10</th><th title="Sum of squared account volume shares. 0–1 scale; unavailable without same-window reconciliation.">HHI</th><th>Coverage</th></tr></thead><tbody>{rows.filter((row) => row?.slug).map((row) => <tr key={row.slug}>
    <th scope="row"><button type="button" onClick={() => onSelect(row)}>{row.name}</button><small>{participantLabel(row.participantType)}</small></th>
    <td>{money(row.attributedVolumeUsd)}</td><td>{Number.isFinite(row.activeParticipants) ? row.activeParticipants.toLocaleString('en-US') : '—'}</td><td>{money(row.meanVolumePerParticipant)}</td><td>{money(row.medianVolumePerParticipant)}</td><td>{percent(row.top5Share)}</td><td>{percent(row.top10Share)}</td><td>{Number.isFinite(row.hhi) ? row.hhi.toFixed(3) : '—'}</td><td>{percent(Number.isFinite(row.coverageRatio) ? row.coverageRatio * 100 : null)}<small>{row.qualityState}</small></td>
  </tr>)}</tbody></table></div>;
}

export default function ParticipationConcentration() {
  const [period, setPeriod] = useState('24h');
  const [selected, setSelected] = useState(null);
  const { data, loading, error, refetch } = useParticipationData(period);
  const rows = Array.isArray(data?.protocols) ? data.protocols : [];
  const detail = selected?.snapshotDate && selected.snapshotDate !== data?.snapshotDate
    ? data?.dailyHistory?.find((day) => day.snapshotDate === selected.snapshotDate)?.protocols.find((row) => row.slug === selected.slug)
    : rows.find((row) => row.slug === selected?.slug);
  return <section className="card participation-concentration" aria-label="Participation and Concentration">
    <div className="market-share-head"><div><span className="analytics-module-kicker">Participation &amp; Concentration</span><h2>What sits beneath tracked trading volume</h2>{data?.coverage && !loading && <p>Participation: {data.coverage.participantAvailable} / {data.coverage.total} · Reconciled concentration: {data.coverage.concentrationAvailable} / {data.coverage.total}</p>}</div><div className="market-share-control-group" aria-label="Participation period">{['24h', '7d', '30d'].map((value) => <button type="button" key={value} className={value === period ? 'is-active' : ''} onClick={() => { setPeriod(value); setSelected(null); }}>{value.toUpperCase()}</button>)}</div></div>
    {loading && <div className="market-share-loading" aria-label="Loading participation"><i /><i /><i /></div>}
    {!loading && error && <div className="market-share-empty"><strong>Participation data is temporarily unavailable.</strong><button type="button" onClick={refetch}>Retry</button></div>}
    {!loading && !error && <>
      <p className="participation-note">24H represents a completed UTC calendar day, not live rolling volume. Account/address counts are participation proxies, not unique people or entities.</p>
      {period === '24h' && <><p className="participation-note">Participant snapshot: {data?.snapshotDate || 'Not collected yet'} (UTC). Missing values remain unavailable.</p><ObservationTable rows={rows} onSelect={setSelected} /></>}
      {period !== '24h' && !data?.sufficientHistory && <div className="market-share-empty"><strong>{period.toUpperCase()} participation history is still being collected</strong><span>{data?.availableDays || 0} of {data?.requiredDays || 0} daily observations available.</span><span>Daily history unlocks automatically. Multi-day distinct accounts and HHI are not reconstructed from daily aggregates.</span></div>}
      {period !== '24h' && data?.sufficientHistory && <><p className="participation-note">{data.periodAggregateReason}</p><div className="participation-history">{data.dailyHistory.map((day) => <details key={day.snapshotDate}><summary>{day.snapshotDate} · UTC daily observation</summary><ObservationTable rows={day.protocols} onSelect={setSelected} /></details>)}</div></>}
      {detail && <div className="participation-detail" role="status"><strong>{detail.name} · {participantLabel(detail.participantType)}</strong><span>Window: {detail.periodStart || 'Unavailable'} → {detail.periodEnd || 'Unavailable'}</span><span>Attributed volume: {preciseMoney(detail.attributedVolumeUsd)} · Mean: {preciseMoney(detail.meanVolumePerParticipant)} · Median: {preciseMoney(detail.medianVolumePerParticipant)}</span><span>{detail.reason}</span><span>Source: {detail.source || 'Unavailable'} · {detail.attribution || 'Unavailable'}</span><span>Top 1: {percent(detail.top1Share)} · Effective participants: {Number.isFinite(detail.effectiveParticipants) ? detail.effectiveParticipants.toFixed(1) : '—'}</span></div>}
      <details className="participation-method"><summary>Methodology &amp; limitations</summary><p>{data?.methodology}</p><p>Half of each matched trade's notional is assigned to each side. Bots, smart accounts and multiple accounts belonging to one entity are not resolved. Low or unknown reconciliation coverage suppresses Top shares and HHI. Unsupported sources are not displayed as zero participants.</p></details>
    </>}
    <AnalyticsCredit />
  </section>;
}
