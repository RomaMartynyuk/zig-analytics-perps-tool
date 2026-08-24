import { useState } from 'react';
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
import ProjectIcon from './components/ProjectIcon';

import { formatUSD, formatPercent } from './lib/format';
import { useDerivativesData } from './hooks/useDerivativesData';
import { upcomingSnapshots, lastTickers } from './data/mockMetrics';

import './App.css';

function StatGrid({ data, loading, error }) {
  // Live data still loading, request failed, or this specific card's value
  // is genuinely unavailable (e.g. 7d/30d volume — see api/derivatives.js
  // for why those are null on purpose) — show NaN rather than a fake number.
  const v = data?.volume;
  const oi = data?.openInterest;
  const requestFailed = !loading && (error || !data);

  return (
    <div className="stat-grid">
      <StatCard
        label="Perp Volume (24h)"
        value={v?.h24}
        change={v?.h24_change}
        loading={loading}
        unavailable={requestFailed || v?.h24 == null}
      />
      <StatCard
        label="Perp Volume (7d)"
        value={v?.d7}
        change={v?.d7_change}
        loading={loading}
        unavailable={requestFailed || v?.d7 == null}
      />
      <StatCard
        label="Perp Volume (30d)"
        value={v?.d30}
        change={v?.d30_change}
        loading={loading}
        unavailable={requestFailed || v?.d30 == null}
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
      <StatGrid data={data} loading={loading} error={error} />

      <div className="row-3col">
        <ChartCard />

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
          renderRow={(p, i) => (
            <>
              <div className="row-left">
                <ProjectIcon name={p.name} index={i} />
                <span className="row-name">{p.name}</span>
              </div>
              <span className="row-value mono">
                {String(p.days).padStart(2, '0')}d:{String(p.hours).padStart(2, '0')}h:
                {String(p.minutes).padStart(2, '0')}m
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
          items={lastTickers}
          renderRow={(p, i) => (
            <>
              <div className="row-left">
                <ProjectIcon name={p.name} index={i} />
                <span className="row-name">{p.ticker}</span>
              </div>
              <span className="row-value">
                ${p.price.toFixed(2)}{' '}
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
