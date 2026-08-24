import projects from '../data/projects.json';
import ProjectIcon from './ProjectIcon';

export default function PredictionsPage() {
  const perps = projects.filter((project) => project.category.toLowerCase().includes('perps'));

  return (
    <section className="predictions-page">
      <div className="predictions-heading">
        <div>
          <h1>Perps Predictions</h1>
          <p>Estimated price per point for each tracked perpetual exchange.</p>
        </div>
        <div className="card-tab">{perps.length} perps</div>
      </div>

      <div className="predictions-grid">
        {perps.map((project, index) => (
          <article className="card prediction-card" key={project.name}>
            <div className="prediction-card-head">
              <div className="row-left">
                <ProjectIcon name={project.name} index={index} />
                <div>
                  <h2>{project.name}</h2>
                  <span>{project.category}</span>
                </div>
              </div>
              <span className="prediction-tier">Tier {project.tier}</span>
            </div>

            <div className="prediction-value">
              <span>Price per point</span>
              <strong>—</strong>
            </div>
            <p className="prediction-pending">Prediction model is being prepared.</p>
          </article>
        ))}
      </div>
    </section>
  );
}
