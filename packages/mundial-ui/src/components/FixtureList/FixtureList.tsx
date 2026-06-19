import './FixtureList.css';
import { Eyebrow } from '../Eyebrow/Eyebrow';
import { Flag } from '../Flag/Flag';

export interface Fixture {
  /** Opponent FIFA code. */
  oppCode: string;
  /** Opponent name. */
  oppName: string;
  venue: string;
  /** Date/time label, e.g. "Jun 16" or "TBD". */
  date: string;
}

export interface FixtureListProps {
  group: string;
  /** Confederation accent color for the kicker + opponent codes. */
  accentColor: string;
  fixtures: Fixture[];
  className?: string;
}

/**
 * The focused nation's group fixtures (opponent, venue, date) — the panel
 * shown beside the globe on hover.
 */
export function FixtureList({ group, accentColor, fixtures, className }: FixtureListProps) {
  return (
    <div className={['mun-fixtures', className].filter(Boolean).join(' ')}>
      <Eyebrow>
        <span style={{ color: accentColor }}>Group {group} · Fixtures</span>
      </Eyebrow>
      <div className="mun-fixtures__list">
        {fixtures.map((f, i) => (
          <div key={i} className="mun-fixtures__row">
            <div className="mun-fixtures__match">
              <span className="mun-fixtures__opp">
                <Flag code={f.oppCode} size="md" />
                vs <span style={{ color: accentColor }}>{f.oppCode}</span> · {f.oppName}
              </span>
              <span className="mun-fixtures__venue">{f.venue}</span>
            </div>
            <span className="mun-fixtures__date">{f.date}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
