import { useState } from 'react';
import projects from '../data/projects.json';
import ProjectIcon from './ProjectIcon';
import { formatTokenPrice } from '../lib/format';

const DEFAULT_ASSUMPTIONS = { pointsMillions: 1_000, fdvMillions: 100 };

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

export default function PredictionsPage() {
  const [assumptions, setAssumptions] = useState({});
  const perps = projects.filter((project) => project.points_snapshot || ['live', 'running'].includes(project.points_status));

  function updateAssumption(name, field, value) {
    setAssumptions((current) => ({
      ...current,
      [name]: { ...(current[name] || DEFAULT_ASSUMPTIONS), [field]: Number(value) },
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
          const values = assumptions[project.name] || DEFAULT_ASSUMPTIONS;
          const userForecast = values.fdvMillions / values.pointsMillions;

          return (
            <article className="card prediction-card" key={project.name}>
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
                  <input
                    type="range"
                    min="10"
                    max="10000"
                    step="10"
                    value={values.pointsMillions}
                    onChange={(event) => updateAssumption(project.name, 'pointsMillions', event.target.value)}
                    aria-label={`${project.name} total points`}
                  />
                </label>
                <label>
                  <span>Project FDV <strong>{formatFdv(values.fdvMillions)}</strong></span>
                  <input
                    type="range"
                    min="1"
                    max="10000"
                    step="1"
                    value={values.fdvMillions}
                    onChange={(event) => updateAssumption(project.name, 'fdvMillions', event.target.value)}
                    aria-label={`${project.name} fully diluted valuation`}
                  />
                </label>
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}
