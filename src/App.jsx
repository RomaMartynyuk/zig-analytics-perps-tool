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
import {
  statCards,
  perpVolumeRanking,
  openInterestRanking,
  upcomingSnapshots,
  lastTickers,
} from './data/mockMetrics';

import './App.css';

function Dashboard() {
  return (
    <>
      <div className="stat-grid">
        {statCards.map((s) => (
          <StatCard key={s.label} {...s} />
        ))}
      </div>

      <div className="row-3col">
        <ChartCard />

        <RankingList
          title="Perp Volume (24h) Ranking"
          items={perpVolumeRanking}
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
          items={openInterestRanking}
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
