import { useEffect, useState } from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import { ChevronDown, ChevronLeft, ChevronRight } from 'lucide-react';
import projects from '../data/projects.json';
import ProjectIcon from './ProjectIcon';
import { usePerpsTickers } from '../hooks/usePerpsTickers';
import { formatTokenPrice, formatUSD } from '../lib/format';

const FALLBACK_ASSUMPTIONS = { pointsMillions: 1_000, fdvMillions: 100, userAllocationPercent: 10 };
const LIGHTER_POINTS_PER_WEEK = 65_000;
const LIGHTER_TOKEN_ALLOCATION = 11_000_000;

function formatPoints(pointsMillions) {
  return pointsMillions >= 1_000
    ? `${(pointsMillions / 1_000).toFixed(pointsMillions % 1_000 ? 1 : 0)}B`
    : `${pointsMillions}M`;
}

function formatFdv(fdvMillions) {
  return fdvMillions >= 1_000
    ? `$${(fdvMillions / 1_000).toFixed(fdvMillions % 1_000 ? 1 : 0)}B`
    : `$${fdvMillions}M`;
}

function formatAllocation(value) {
  if (value >= 1_000_000_000) return `$${(value / 1_000_000_000).toFixed(1)}B`;
  if (value >= 1_000_000) return `$${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `$${(value / 1_000).toFixed(1)}K`;
  return `$${value.toFixed(1)}`;
}

function getProjectDefaults(project) {
  const defaults = project.prediction_defaults;
  const pointsMillions = Number(defaults?.points_millions);
  const fdvMillions = Number(defaults?.fdv_millions);
  const userAllocationPercent = Number(defaults?.user_allocation_percent);
  return {
    pointsMillions: Number.isFinite(pointsMillions) && pointsMillions > 0 ? pointsMillions : FALLBACK_ASSUMPTIONS.pointsMillions,
    fdvMillions: Number.isFinite(fdvMillions) && fdvMillions > 0 ? fdvMillions : FALLBACK_ASSUMPTIONS.fdvMillions,
    userAllocationPercent: Number.isFinite(userAllocationPercent) && userAllocationPercent > 0 && userAllocationPercent <= 100
      ? userAllocationPercent
      : FALLBACK_ASSUMPTIONS.userAllocationPercent,
  };
}

function ProjectHeader({ project, index }) {
  return (
    <div className="prediction-card-head">
      <div className="row-left">
        <ProjectIcon name={project.name} index={index} />
        <div>
          <h2>{project.name}</h2>
          <span>{project.points_status === 'running' ? 'Points running' : 'Points active'}</span>
        </div>
      </div>
      <span className="prediction-tier">Tier {project.tier}</span>
    </div>
  );
}

function PersonalAllocation({ projectName, points, allocation, onChange }) {
  const hasAllocation = Number.isFinite(allocation) && allocation > 0;

  return (
    <div className="personal-allocation">
      <div>
        <span>Your allocation</span>
        <AnimatedResult className="allocation-result">{hasAllocation ? formatAllocation(allocation) : '—'}</AnimatedResult>
      </div>
      <label>
        <span>Your points</span>
        <input
          type="number"
          min="0"
          step="any"
          inputMode="decimal"
          value={points}
          onChange={(event) => onChange(event.target.value)}
          placeholder="0"
          aria-label={`${projectName} your points`}
        />
      </label>
    </div>
  );
}

function AnimatedResult({ children, className }) {
  const reduceMotion = useReducedMotion();

  return (
    <motion.strong
      key={String(children)}
      className={className}
      initial={{ opacity: reduceMotion ? 1 : 0.58, y: reduceMotion ? 0 : 3 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: reduceMotion ? 0 : 0.16, ease: [0.22, 1, 0.36, 1] }}
    >
      {children}
    </motion.strong>
  );
}

export default function PredictionsPage() {
  const [assumptions, setAssumptions] = useState({});
  const [ownedPoints, setOwnedPoints] = useState({});
  const [lighterWeeks, setLighterWeeks] = useState(12);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [transitionDirection, setTransitionDirection] = useState('neutral');
  const [pageVisible, setPageVisible] = useState(() => document.visibilityState !== 'hidden');
  const reduceMotion = useReducedMotion();
  const { data: tickers } = usePerpsTickers();
  const litPrice = tickers.find((ticker) => ticker.ticker === 'LIT')?.price;
  const lighterValue = Number.isFinite(litPrice) ? LIGHTER_TOKEN_ALLOCATION * litPrice : null;
  const lighterForecast = lighterValue == null ? null : lighterValue / (LIGHTER_POINTS_PER_WEEK * lighterWeeks);
  const perps = projects.filter((project) => project.points_snapshot || ['live', 'running'].includes(project.points_status));
  const selectedProject = perps[selectedIndex];

  useEffect(() => {
    const updateVisibility = () => setPageVisible(document.visibilityState !== 'hidden');
    document.addEventListener('visibilitychange', updateVisibility);
    return () => document.removeEventListener('visibilitychange', updateVisibility);
  }, []);

  function updateAssumption(project, field, value) {
    setAssumptions((current) => ({
      ...current,
      [project.name]: { ...(current[project.name] || getProjectDefaults(project)), [field]: Number(value) },
    }));
  }

  function updateOwnedPoints(projectName, value) {
    setOwnedPoints((current) => ({ ...current, [projectName]: value }));
  }

  function selectProject(index, direction = 'neutral') {
    const nextIndex = Math.max(0, Math.min(perps.length - 1, Number(index)));
    if (nextIndex === selectedIndex) return;
    setTransitionDirection(direction);
    setSelectedIndex(nextIndex);
  }

  const projectEntrance = reduceMotion
    ? { opacity: 1 }
    : {
        opacity: 0,
        x: transitionDirection === 'next' ? 22 : transitionDirection === 'previous' ? -22 : 0,
        y: transitionDirection === 'neutral' ? 5 : 0,
      };
  const projectTransition = { duration: reduceMotion ? 0.08 : 0.28, ease: [0.22, 1, 0.36, 1] };

  function renderCalculator(project, index) {
    if (project.name === 'Lighter') {
      const personalPoints = ownedPoints[project.name] ?? '';
      const personalAllocation = lighterForecast == null ? null : Number(personalPoints) * lighterForecast;

      return (
        <motion.article
          className="prediction-workspace lighter-prediction-workspace"
          key={project.name}
          initial={projectEntrance}
          animate={{ opacity: 1, x: 0, y: 0 }}
          transition={projectTransition}
        >
          <motion.div className="lighter-workspace-head" initial={reduceMotion ? false : { opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ ...projectTransition, delay: reduceMotion ? 0 : .05 }}>
            <ProjectHeader project={project} index={index} />
            <span className="lighter-model-label">Dedicated campaign model</span>
          </motion.div>
          <div className="lighter-workspace-grid">
            <motion.section className="lighter-campaign-panel" initial={reduceMotion ? false : { opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ ...projectTransition, delay: reduceMotion ? 0 : .1 }}>
              <div className="robinhood-heading">
                <span>Robinhood campaign</span>
                <small>Lighter-specific model</small>
              </div>
              <div className="robinhood-equation">
                <span>11M LIT × {formatTokenPrice(litPrice)}</span>
                <strong>= {lighterValue == null ? '—' : formatUSD(lighterValue)}</strong>
              </div>
              <label className="lighter-duration-control">
                <span>Campaign duration <strong>{lighterWeeks} weeks</strong></span>
                <input type="range" min="4" max="60" step="1" value={lighterWeeks} onChange={(event) => setLighterWeeks(Number(event.target.value))} aria-label="Robinhood campaign duration in weeks" />
              </label>
              <PersonalAllocation
                projectName={project.name}
                points={personalPoints}
                allocation={personalAllocation}
                onChange={(value) => updateOwnedPoints(project.name, value)}
              />
            </motion.section>
            <motion.section className="lighter-result-panel" initial={reduceMotion ? false : { opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ ...projectTransition, delay: reduceMotion ? 0 : .16 }}>
              <span className="result-eyebrow">Your weekly forecast</span>
              <AnimatedResult className="primary-point-result">{formatTokenPrice(lighterForecast)}</AnimatedResult>
              <small>per point · {lighterWeeks} weeks</small>
              <div className="lighter-result-equation">
                <span>Campaign value</span>
                <b>{lighterValue == null ? '—' : formatUSD(lighterValue)}</b>
              </div>
            </motion.section>
          </div>
          <span className="prediction-credit">ZigAnalytics by @herzig_crypto</span>
        </motion.article>
      );
    }

    const values = assumptions[project.name] || getProjectDefaults(project);
    const userForecast = (values.fdvMillions * (values.userAllocationPercent / 100)) / values.pointsMillions;
    const personalPoints = ownedPoints[project.name] ?? '';
    const personalAllocation = Number(personalPoints) * userForecast;

    return (
      <motion.article
        className="prediction-workspace standard-prediction-workspace"
        key={project.name}
        initial={projectEntrance}
        animate={{ opacity: 1, x: 0, y: 0 }}
        transition={projectTransition}
      >
        <motion.section className="prediction-parameters" initial={reduceMotion ? false : { opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ ...projectTransition, delay: reduceMotion ? 0 : .05 }}>
          <ProjectHeader project={project} index={index} />
          <div className="prediction-controls">
            <label>
              <span>Total points <strong>{formatPoints(values.pointsMillions)}</strong></span>
              <input type="range" min="10" max="10000" step="10" value={values.pointsMillions} onChange={(event) => updateAssumption(project, 'pointsMillions', event.target.value)} aria-label={`${project.name} total points`} />
            </label>
            <label>
              <span>Project FDV <strong>{formatFdv(values.fdvMillions)}</strong></span>
              <input type="range" min="1" max="10000" step="1" value={values.fdvMillions} onChange={(event) => updateAssumption(project, 'fdvMillions', event.target.value)} aria-label={`${project.name} fully diluted valuation`} />
            </label>
            <label>
              <span>Users&apos; FDV allocation <strong>{values.userAllocationPercent}%</strong></span>
              <input type="range" min="1" max="100" step="1" value={values.userAllocationPercent} onChange={(event) => updateAssumption(project, 'userAllocationPercent', event.target.value)} aria-label={`${project.name} FDV allocated to users`} />
            </label>
          </div>
        </motion.section>
        <motion.section className="prediction-results" initial={reduceMotion ? false : { opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ ...projectTransition, delay: reduceMotion ? 0 : .12 }}>
          <div className="prediction-result-glow" aria-hidden="true" />
          <div className="primary-result-block">
            <span className="result-eyebrow">Your forecast</span>
            <AnimatedResult className="primary-point-result">{formatTokenPrice(userForecast)}</AnimatedResult>
            <small>per point</small>
          </div>
          <div className="prediction-secondary-results">
            <div className="prediction-forecast polymarket-forecast">
              <span>PolyMarket forecast</span>
              <strong>—</strong>
              <small>Feed coming soon</small>
            </div>
            <PersonalAllocation
              projectName={project.name}
              points={personalPoints}
              allocation={personalAllocation}
              onChange={(value) => updateOwnedPoints(project.name, value)}
            />
          </div>
        </motion.section>
        <span className="prediction-credit">ZigAnalytics by @herzig_crypto</span>
      </motion.article>
    );
  }

  return (
    <section className={`predictions-page ${pageVisible ? '' : 'ambient-paused'}`}>
      <motion.div className="prediction-lab-heading" initial={reduceMotion ? false : { opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: reduceMotion ? .08 : .54, delay: reduceMotion ? 0 : .04, ease: [0.22, 1, 0.36, 1] }}>
        <div>
          <span className="prediction-kicker">Farming signals · 01</span>
          <h1>Point Value Lab</h1>
          <p>Build a price-per-point estimate from your own points and FDV assumptions.</p>
        </div>
        <div className="prediction-campaign-count">{perps.length} active campaigns</div>
      </motion.div>

      <motion.div className="prediction-project-switcher" aria-label="Points calculator selector" initial={reduceMotion ? false : { opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: reduceMotion ? .08 : .5, delay: reduceMotion ? 0 : .11, ease: [0.22, 1, 0.36, 1] }}>
        <button type="button" onClick={() => selectProject(selectedIndex - 1, 'previous')} disabled={selectedIndex === 0} aria-label="Previous project"><ChevronLeft size={20} /></button>
        <motion.div className="prediction-project-identity" key={selectedProject.name} initial={reduceMotion ? false : { opacity: 0, y: 5 }} animate={{ opacity: 1, y: 0 }} transition={projectTransition}>
          <label className="prediction-project-select">
            <ProjectIcon name={selectedProject.name} index={selectedIndex} size={28} />
            <select value={selectedIndex} onChange={(event) => selectProject(event.target.value, 'neutral')} aria-label="Select points calculator">
              {perps.map((project, index) => <option value={index} key={project.name}>{project.name}</option>)}
            </select>
            <ChevronDown className="prediction-select-chevron" size={17} aria-hidden="true" />
          </label>
          <span className="prediction-position">{String(selectedIndex + 1).padStart(2, '0')} / {String(perps.length).padStart(2, '0')}</span>
        </motion.div>
        <button type="button" onClick={() => selectProject(selectedIndex + 1, 'next')} disabled={selectedIndex === perps.length - 1} aria-label="Next project"><ChevronRight size={20} /></button>
      </motion.div>

      {renderCalculator(selectedProject, selectedIndex)}
    </section>
  );
}
