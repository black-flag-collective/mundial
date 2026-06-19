import './StandingsTable.css';
import { Flag } from '../Flag/Flag';

export interface StandingRow {
  code: string;
  name: string;
  /** Played, Won, Drawn, Lost. */
  P: number;
  W: number;
  D: number;
  L: number;
  /** Goal difference (signed). */
  GD: number;
  /** Points. */
  Pts: number;
}

export interface StandingsTableProps {
  group: string;
  /** Rows in finishing order (top = 1st). */
  rows: StandingRow[];
  /** How many top rows advance (highlighted). Default 2. */
  advancing?: number;
  /** Fires with a team code on row hover, or null on leave. */
  onTeamHover?: (code: string | null) => void;
  className?: string;
}

const fmtGD = (gd: number) => (gd > 0 ? `+${gd}` : String(gd));

/**
 * A single group's live table (P/W/D/L/GD/Pts). The top `advancing` rows are
 * highlighted with the accent bar as qualifying for the Round of 32.
 */
export function StandingsTable({
  group, rows, advancing = 2, onTeamHover, className
}: StandingsTableProps) {
  return (
    <div className={['mun-standings', className].filter(Boolean).join(' ')}>
      <div className="mun-standings__head">
        <span />
        <span className="mun-standings__group">Group {group}</span>
        {['P', 'W', 'D', 'L', 'GD'].map((h) => (
          <span key={h} className="mun-standings__col">{h}</span>
        ))}
        <span className="mun-standings__col mun-standings__col--pts">Pts</span>
      </div>
      {rows.map((r, idx) => {
        const qualifies = idx < advancing;
        const playoff = idx === advancing;
        return (
          <div
            key={r.code}
            className="mun-standings__row"
            data-qualifies={qualifies || undefined}
            data-playoff={playoff || undefined}
            onMouseEnter={() => onTeamHover?.(r.code)}
            onMouseLeave={() => onTeamHover?.(null)}
            onClick={() => onTeamHover?.(r.code)}
          >
            <span className="mun-standings__pos">{idx + 1}</span>
            <span className="mun-standings__team">
              <Flag code={r.code} size="sm" />
              <span className="mun-standings__code">{r.code}</span>
              <span className="mun-standings__name">{r.name}</span>
            </span>
            <span className="mun-standings__val">{r.P}</span>
            <span className="mun-standings__val">{r.W}</span>
            <span className="mun-standings__val">{r.D}</span>
            <span className="mun-standings__val">{r.L}</span>
            <span className="mun-standings__val">{fmtGD(r.GD)}</span>
            <span className="mun-standings__pts">{r.Pts}</span>
          </div>
        );
      })}
    </div>
  );
}
