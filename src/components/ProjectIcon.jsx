import { getAccent } from '../lib/icons';

export default function ProjectIcon({ name, index = 0, size = 30 }) {
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
