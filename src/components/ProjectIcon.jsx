import { useState } from 'react';
import { getAccent } from '../lib/icons';
import { getLogoUrl } from '../lib/projectLogos';

export default function ProjectIcon({ name, index = 0, size = 30 }) {
  const [failed, setFailed] = useState(false);
  const logoUrl = getLogoUrl(name);

  // Real logo available and hasn't failed to load — use it.
  if (logoUrl && !failed) {
    return (
      <img
        src={logoUrl}
        alt={name}
        width={size}
        height={size}
        className="project-icon project-icon-img"
        onError={() => setFailed(true)}
      />
    );
  }

  // Fallback: colored circle + first letter — used when we have no
  // defillama_slug for this project, or the CDN doesn't have an icon for it.
  return (
    <div
      className="project-icon"
      style={{
        width: size,
        height: size,
        background: getAccent(index),
        fontSize: size * 0.4,
      }}
    >
      {name[0]}
    </div>
  );
}
