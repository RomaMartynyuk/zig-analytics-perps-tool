import { useEffect, useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';

import Sidebar from './components/Sidebar';
import Header from './components/Header';
import StatCard from './components/StatCard';
import ChartCard from './components/ChartCard';
import RankingList from './components/RankingList';
import NewsCard from './components/NewsCard';
import Footer from './components/Footer';
import ComingSoon from './components/ComingSoon';
import ProjectsPage from './components/ProjectsPage';
import FundingPage from './components/FundingPage';
import PredictionsPage from './components/PredictionsPage';
import ProjectIcon from './components/ProjectIcon';

import { formatUSD, formatPercent, formatTokenPrice } from './lib/format';
import { useDerivativesData } from './hooks/useDerivativesData';
import { usePerpsTickers } from './hooks/usePerpsTickers';
import projects from './data/projects.json';
import { formatCountdown, getRecurringSnapshot } from './lib/pointsSnapshots';

import './App.css';

function StatGrid({ data, loading, error, snapshots, tickers, tickersLoading, tickersError, now }) {
  // Live data still loading, request failed, or this specific card's value
  // is genuinely unavailable — show NaN rather than a fake number.
  const v = data?.volume;
  const oi = data?.openInterest;
  const requestFailed = !loading && (error || !data);
  const nextSnapshotSlides = snapshots.slice(0, 3).map((snapshot) => ({
    id: snapshot.name,
    name: snapshot.name,
    value: snapshot.isPointsDay ? 'Points Day' : formatCountdown(snapshot.scheduledAt, now),
    tone: snapshot.isPointsDay ? 'up' : '',
  }));
  const bestTickerSlides = [...tickers]
    .sort((a, b) => b.change - a.change)
    .slice(0, 3)
    .map((ticker) => ({
      id: ticker.ticker,
      name: ticker.ticker,
      value: formatPercent(ticker.change),
      detail: formatTokenPrice(ticker.price),
      tone: ticker.change >= 0 ? 'up' : 'down',
    }));

  return (
    <div className="stat-grid">
      <StatCard
        label="Perp Volume (24h)"
        value={v?.h24}
        change={v?.h24_change}
        loading={loading}
        unavailable={requestFailed || v?.h24 == null}
      />
      <StatCard label="Next Snapshot" slides={nextSnapshotSlides} unavailable={!nextSnapshotSlides.length} />
      <StatCard
        label="Best Ticker (24h)"
        slides={bestTickerSlides}
        loading={tickersLoading}
        unavailable={!tickersLoading && (tickersError || !bestTickerSlides.length)}
      />
      <StatCard
        label="Open Interest"
        value={oi?.current}
        change={null}
        loading={loading}
        unavailable={requestFailed || oi?.current == null}
      />
    </div>
  );
}

function Dashboard() {
  const { data, loading, error } = useDerivativesData();
  const { data: tickers, loading: tickersLoading, error: tickersError } = usePerpsTickers();
  const [snapshotNow, setSnapshotNow] = useState(() => new Date());

  useEffect(() => {
    const interval = setInterval(() => setSnapshotNow(new Date()), 1000);
    return () => clearInterval(interval);
  }, []);

  const upcomingSnapshots = useMemo(
    () => projects
      .map((project) => getRecurringSnapshot(project, snapshotNow))
      .filter(Boolean)
      .sort((a, b) => {
        if (a.isPointsDay !== b.isPointsDay) return a.isPointsDay ? -1 : 1;
        return (a.scheduledAt ?? a.endsAt) - (b.scheduledAt ?? b.endsAt);
      }),
    [snapshotNow]
  );

  // Real Perp Volume ranking — built from the same /api/derivatives call as
  // the stat cards above. Only exchanges whose public API and USD units are
  // verified are included; unavailable sources return null on purpose.
  // Only successfully-fetched exchanges are shown, sorted high to low —
  // projects with no volume data simply don't appear in this list.
  const volumeRanking = (data?.meta?.volumeSources || [])
    .filter((s) => s.ok && typeof s.value === 'number')
    .sort((a, b) => b.value - a.value);

  const volumeTabLabel = loading
    ? 'Loading…'
    : volumeRanking.length
    ? `${volumeRanking.length} of 20 live`
    : 'No data yet';

  // Same pattern for Open Interest — real per-exchange breakdown from the
  // same /api/derivatives call, sorted high to low, only successfully
  // fetched exchanges shown.
  const oiRanking = (data?.meta?.openInterestSources || [])
    .filter((s) => s.ok && typeof s.value === 'number')
    .sort((a, b) => b.value - a.value);

  const oiTabLabel = loading
    ? 'Loading…'
    : oiRanking.length
    ? `${oiRanking.length} of 20 live`
    : 'No data yet';

  return (
    <>
      <StatGrid
        data={data}
        loading={loading}
        error={error}
        snapshots={upcomingSnapshots}
        tickers={tickers}
        tickersLoading={tickersLoading}
        tickersError={tickersError}
        now={snapshotNow}
      />

      <div className="row-3col">
        <ChartCard sources={volumeRanking} loading={loading} error={error} />

        <RankingList
          title="Perp Volume (24h) Ranking"
          tabLabel={volumeTabLabel}
          items={volumeRanking}
          emptyMessage={
            loading
              ? 'Loading live volume…'
              : "No live volume data yet — this needs a real deploy, `vite dev` can't reach /api routes."
          }
          renderRow={(p, i) => (
            <>
              <div className="row-left">
                <ProjectIcon name={p.name} index={i} />
                <span className="row-name">{p.name}</span>
              </div>
              <span className="row-value">{formatUSD(p.value)}</span>
            </>
          )}
        />

        <RankingList
          title="Upcoming Snapshots"
          items={upcomingSnapshots}
          emptyMessage="Add a recurring points day in projects.json to show it here."
          renderRow={(p, i) => (
            <>
              <div className="row-left">
                <ProjectIcon name={p.name} index={i} />
                <span className="row-name">{p.name}</span>
              </div>
              <span className="row-value mono">
                {p.isPointsDay ? 'Points Day' : formatCountdown(p.scheduledAt, snapshotNow)}
              </span>
            </>
          )}
        />
      </div>

      <div className="row-3col">
        <NewsCard />

        <RankingList
          title="Open Interest Ranking"
          tabLabel={oiTabLabel}
          items={oiRanking}
          emptyMessage={
            loading
              ? 'Loading live open interest…'
              : "No live OI data yet — this needs a real deploy, `vite dev` can't reach /api routes."
          }
          renderRow={(p, i) => (
            <>
              <div className="row-left">
                <ProjectIcon name={p.name} index={i} />
                <span className="row-name">{p.name}</span>
              </div>
              <span className="row-value">{formatUSD(p.value)}</span>
            </>
          )}
        />

        <RankingList
          title="Last Perps Tickers"
          tabLabel="CoinGecko · 24h"
          items={tickers}
          emptyMessage={
            tickersLoading
              ? 'Loading live token prices…'
              : tickersError
                ? 'Live token prices are temporarily unavailable.'
                : 'No live token prices available.'
          }
          renderRow={(p, i) => (
            <>
              <div className="row-left">
                <ProjectIcon name={p.name} index={i} />
                <span className="row-name">{p.ticker}</span>
              </div>
              <span className="row-value">
                {formatTokenPrice(p.price)}{' '}
                <span className={p.change >= 0 ? 'up' : 'down'}>{formatPercent(p.change)}</span>
              </span>
            </>
          )}
        />
      </div>
    </>
  );
}

export default function App() {
  const [active, setActive] = useState('dashboard');

  return (
    <div className="app-shell">
      <Sidebar active={active} onChange={setActive} />

      <main className="main">
        <Header />

        <AnimatePresence mode="wait">
          <motion.div
            key={active}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.18, ease: 'easeOut' }}
          >
            {active === 'dashboard' ? (
              <Dashboard />
            ) : active === 'projects' ? (
              <ProjectsPage />
            ) : active === 'funding' ? (
              <FundingPage />
            ) : active === 'predictions' ? (
              <PredictionsPage />
            ) : (
              <ComingSoon section={active} />
            )}
          </motion.div>
        </AnimatePresence>

        <Footer />
      </main>
    </div>
  );
}
