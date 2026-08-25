import { useState } from 'react';
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

export default function PredictionsPage() {
  const [assumptions, setAssumptions] = useState({});
  const [lighterWeeks, setLighterWeeks] = useState(12);
  const { data: tickers } = usePerpsTickers();
  const litPrice = tickers.find((ticker) => ticker.ticker === 'LIT')?.price;
  const lighterValue = Number.isFinite(litPrice) ? LIGHTER_TOKEN_ALLOCATION * litPrice : null;
  const lighterForecast = lighterValue == null ? null : lighterValue / (LIGHTER_POINTS_PER_WEEK * lighterWeeks);
  const perps = projects.filter((project) => project.points_snapshot || ['live', 'running'].includes(project.points_status));

  function updateAssumption(project, field, value) {
    setAssumptions((current) => ({
      ...current,
      [project.name]: { ...(current[project.name] || getProjectDefaults(project)), [field]: Number(value) },
    }));
  }

  return (
    <section className="predictions-page">
      <div className="prediction-lab-heading">
        <div>
          <span className="prediction-kicker">Farming signals · 01</span>
          <h1>Point Value Lab</h1>
          <p>Build a price-per-point estimate from your own points and FDV assumptions.</p>
        </div>
        <div className="card-tab">{perps.length} active campaigns</div>
      </div>

      <div className="predictions-grid">
        {perps.map((project, index) => {
          if (project.name === 'Lighter') {
            return (
              <article className="card prediction-card lighter-prediction-card" key={project.name}>
                <ProjectHeader project={project} index={index} />
                <div className="robinhood-campaign">
                  <div className="robinhood-heading">
                    <span>Robinhood campaign</span>
                    <small>Lighter-specific model</small>
                  </div>
                  <div className="robinhood-equation">
                    <span>11M LIT × {formatTokenPrice(litPrice)}</span>
                    <strong>= {lighterValue == null ? '—' : formatUSD(lighterValue)}</strong>
                  </div>
                  <div className="prediction-forecast user-forecast lighter-user-forecast">
                    <span>Your weekly forecast</span>
                    <strong>{formatTokenPrice(lighterForecast)}</strong>
                    <small>per point · {lighterWeeks} weeks</small>
                  </div>
                  <label className="lighter-duration-control">
                    <span>Campaign duration <strong>{lighterWeeks} weeks</strong></span>
                    <input type="range" min="4" max="60" step="1" value={lighterWeeks} onChange={(event) => setLighterWeeks(Number(event.target.value))} aria-label="Robinhood campaign duration in weeks" />
                  </label>
                </div>
                <span className="prediction-credit">ZigAnalytics by @herzig_crypto</span>
              </article>
            );
          }

          const values = assumptions[project.name] || getProjectDefaults(project);
          const userForecast = (values.fdvMillions * (values.userAllocationPercent / 100)) / values.pointsMillions;

          return (
            <article className="card prediction-card" key={project.name}>
              <ProjectHeader project={project} index={index} />
              <div className="prediction-forecasts">
                <div className="prediction-forecast polymarket-forecast">
                  <span>PolyMarket forecast</span>
                  <strong>—</strong>
                  <small>Feed coming soon</small>
                </div>
                <div className="prediction-forecast user-forecast">
                  <span>Your forecast</span>
                  <strong>{formatTokenPrice(userForecast)}</strong>
                  <small>per point</small>
                </div>
              </div>
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
              <span className="prediction-credit">ZigAnalytics by @herzig_crypto</span>
            </article>
          );
        })}
      </div>
    </section>
  );
}
