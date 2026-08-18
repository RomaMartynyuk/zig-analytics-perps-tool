import { useProjectsData } from '../hooks/useProjectsData';
import RankingList from './RankingList';
import ProjectIcon from './ProjectIcon';
import { formatUSD } from '../lib/format';

export default function ProjectsPage() {
  const { projects, loading, error, refetch } = useProjectsData();

  return (
    <div className="page-single-col">
      {error && (
        <div className="error-banner">
          Couldn't load live data.
          <button onClick={refetch}>Retry</button>
        </div>
      )}

      <RankingList
        title="Tracked Projects — Live TVL"
        tabLabel={loading ? 'Loading…' : `${projects?.length ?? 0} projects`}
        items={projects || []}
        maxHeight={440}
        renderRow={(p, i) => (
          <>
            <div className="row-left">
              <ProjectIcon name={p.name} index={i} />
              <div>
                <span className="row-name">{p.name}</span>
                <div className="row-sub">Tier {p.tier} · {p.category}</div>
              </div>
            </div>
            <span className="row-value">
              {p.tvlData ? formatUSD(p.tvlData.tvl) : <span className="manual-tag">Manual</span>}
            </span>
          </>
        )}
      />

      <p className="page-note">
        TVL pulled live from DeFiLlama. Projects marked "Manual" aren't indexed
        there yet — expected for new / invite-only protocols, tracked by hand
        until they are.
      </p>
    </div>
  );
}
