import './DayTimeline.css';
import { useRef } from 'react';

export interface DayTimelineProps {
  /** Short day labels in order, e.g. ["Jun 11", "Jun 12", …]. */
  days: string[];
  /** Index of the selected day. */
  value: number;
  onChange: (index: number) => void;
  /** Helper line under the track. */
  caption?: string;
  className?: string;
}

/**
 * Draggable date scrubber for replaying the tournament day by day. Click a dot
 * or drag along the track to select; arrow keys step. Past days fill in accent.
 */
export function DayTimeline({
  days, value, onChange, caption = 'Drag back through the tournament to replay every result', className
}: DayTimelineProps) {
  const trackRef = useRef<HTMLDivElement>(null);
  const last = Math.max(1, days.length - 1);
  const pct = (i: number) => `${(i / last) * 100}%`;

  const nearestFromEvent = (clientX: number) => {
    const el = trackRef.current;
    if (!el) return value;
    const rect = el.getBoundingClientRect();
    const t = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
    return Math.round(t * last);
  };

  return (
    <div className={['mun-timeline', className].filter(Boolean).join(' ')}>
      <div
        ref={trackRef}
        className="mun-timeline__track"
        role="slider"
        tabIndex={0}
        aria-valuemin={0}
        aria-valuemax={last}
        aria-valuenow={value}
        aria-valuetext={days[value]}
        onPointerDown={(e) => {
          (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
          onChange(nearestFromEvent(e.clientX));
        }}
        onPointerMove={(e) => {
          if (e.buttons === 1) onChange(nearestFromEvent(e.clientX));
        }}
        onKeyDown={(e) => {
          if (e.key === 'ArrowLeft') onChange(Math.max(0, value - 1));
          if (e.key === 'ArrowRight') onChange(Math.min(last, value + 1));
        }}
      >
        <div className="mun-timeline__rail" />
        <div className="mun-timeline__fill" style={{ width: pct(value) }} />
        {days.map((_, i) => (
          <div
            key={i}
            className="mun-timeline__tick"
            style={{ left: pct(i) }}
            onClick={(e) => { e.stopPropagation(); onChange(i); }}
          >
            <span
              className="mun-timeline__dot"
              data-past={i <= value || undefined}
              data-active={i === value || undefined}
            />
          </div>
        ))}
        <div className="mun-timeline__handle" style={{ left: pct(value) }} />
      </div>
      <div className="mun-timeline__labels">
        {days.map((d, i) => (
          <span key={i} className="mun-timeline__label" data-active={i === value || undefined}>{d}</span>
        ))}
      </div>
      {caption && <span className="mun-timeline__caption">{caption}</span>}
    </div>
  );
}
