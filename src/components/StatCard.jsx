import { useState } from 'react';
import { formatStatUSD, formatPercent } from '../lib/format';

export default function StatCard({ label, value, change, loading, unavailable, slides }) {
  const [selectedSlide, setSelectedSlide] = useState(0);
  const safeSlideIndex = Math.min(selectedSlide, Math.max(0, (slides?.length || 1) - 1));
  const slide = slides?.[safeSlideIndex];

  return (
    <div className="card stat-card">
      <div className="stat-label">{label}</div>

      {loading ? (
        <div className="stat-row">
          <span className="skeleton-line" style={{ width: 90, height: 22 }} />
        </div>
      ) : unavailable ? (
        <div className="stat-row">
          <span className="stat-value stat-nan">NaN</span>
        </div>
      ) : slide ? (
        <div className="stat-carousel-row">
          <div className="stat-carousel-content">
            <span className="stat-carousel-name">{slide.name}</span>
            <span className={`stat-value ${slide.tone || ''}`}>{slide.value}</span>
            {slide.detail && <span className="stat-carousel-detail">{slide.detail}</span>}
          </div>
          {slides.length > 1 && (
            <div className="stat-dots" aria-label={`${label} options`}>
              {slides.map((item, index) => (
                <button
                  key={item.id}
                  type="button"
                  className={`stat-dot ${index === safeSlideIndex ? 'active' : ''}`}
                  onClick={() => setSelectedSlide(index)}
                  aria-label={`Show ${item.name}`}
                  aria-pressed={index === safeSlideIndex}
                />
              ))}
            </div>
          )}
        </div>
      ) : (
        <div className="stat-row">
          <span className="stat-value">{formatStatUSD(value)}</span>
          {change != null && (
            <span className={`stat-change ${change >= 0 ? 'up' : 'down'}`}>
              {formatPercent(change)}
            </span>
          )}
        </div>
      )}
    </div>
  );
}
