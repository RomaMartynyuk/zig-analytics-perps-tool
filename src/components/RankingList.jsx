export default function RankingList({ title, tabLabel, items, renderRow, maxHeight }) {
  return (
    <div className="card list-card">
      <div className="card-head">
        <div className="card-title">{title}</div>
        {tabLabel && <div className="card-tab">{tabLabel}</div>}
      </div>

      <div className="list-scroll scroll-area" style={maxHeight ? { maxHeight } : undefined}>
        {items.map((item, i) => (
          <div className="list-row" key={item.name + i}>
            {renderRow(item, i)}
          </div>
        ))}
      </div>
      <div className="list-fade" />
    </div>
  );
}
