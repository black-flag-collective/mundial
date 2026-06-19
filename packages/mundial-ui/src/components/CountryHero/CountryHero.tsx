import './CountryHero.css';
import { Flag } from '../Flag/Flag';

export interface CountryHeroProps {
  /** Full nation name (shown as a colored kicker). */
  name: string;
  /** FIFA code, rendered oversized. */
  code: string;
  group: string;
  confederation: { label: string; color: string };
  /** Flag code, if it differs from `code`. */
  flagCode?: string;
  className?: string;
}

/**
 * The centered nation spotlight shown when a country is focused on the globe:
 * colored name kicker, flag, giant code, and group + confederation badges.
 */
export function CountryHero({
  name, code, group, confederation, flagCode, className
}: CountryHeroProps) {
  return (
    <div className={['mun-country', className].filter(Boolean).join(' ')}>
      <span className="mun-country__name" style={{ color: confederation.color }}>{name}</span>
      <Flag code={flagCode ?? code} size="lg" />
      <span className="mun-country__code">{code}</span>
      <div className="mun-country__badges">
        <span className="mun-country__badge">Group {group}</span>
        <span className="mun-country__badge mun-country__badge--confed" style={{ color: confederation.color }}>
          {confederation.label}
        </span>
      </div>
    </div>
  );
}
