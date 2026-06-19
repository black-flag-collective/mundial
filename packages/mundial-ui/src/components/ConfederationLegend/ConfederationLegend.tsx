import './ConfederationLegend.css';
import { Eyebrow } from '../Eyebrow/Eyebrow';
import { CONFEDERATION_LIST, type ConfederationInfo } from '../../data/confederations';

export interface ConfederationLegendProps {
  /** Items to show. Defaults to all six FIFA confederations. */
  items?: ConfederationInfo[];
  title?: string;
  className?: string;
}

/**
 * The glowing color-key for confederations shown beside the globe. Defaults to
 * all six (AFC, CAF, CONCACAF, CONMEBOL, OFC, UEFA).
 */
export function ConfederationLegend({
  items = CONFEDERATION_LIST, title = 'Confederations', className
}: ConfederationLegendProps) {
  return (
    <div className={['mun-legend', className].filter(Boolean).join(' ')}>
      <Eyebrow tone="subtle">{title}</Eyebrow>
      <div className="mun-legend__items">
        {items.map((c) => (
          <div key={c.label} className="mun-legend__item">
            <span className="mun-legend__dot" style={{ background: c.color, boxShadow: `0 0 10px ${c.color}` }} />
            <span className="mun-legend__label">{c.label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
