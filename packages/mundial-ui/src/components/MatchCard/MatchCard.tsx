import './MatchCard.css';
import { Flag } from '../Flag/Flag';

export interface MatchTeam {
  code: string;
  name: string;
  /** Goals scored (final matches only). */
  score?: number;
}

/** Knockout round codes → display labels. A tie is either group-stage (`group`)
 *  or knockout (`round`); when `round` is set it replaces the group badge. */
const ROUND_LABELS: Record<string, string> = {
  R32: 'Round of 32', R16: 'Round of 16', QF: 'Quarter-final',
  SF: 'Semi-final', '3P': 'Third place', F: 'Final',
};

export interface MatchCardProps {
  /** Group letter (group-stage ties). */
  group?: string;
  /** Knockout round code (R32/R16/QF/SF/3P/F). Shown instead of the group badge. */
  round?: string;
  /** 'final' shows scores; 'upcoming' shows the kickoff label in `status`. */
  state: 'final' | 'upcoming';
  /** Short status text, e.g. "FT" or "6:00 PM ET". */
  status: string;
  teamA: MatchTeam;
  teamB: MatchTeam;
  /** Highlights the card as the selected/featured fixture. */
  selected?: boolean;
  onClick?: () => void;
  onMouseEnter?: () => void;
  onMouseLeave?: () => void;
  className?: string;
}

/**
 * A fixture card for the day's slate. Finished matches show both scores (the
 * winner's in the accent color); upcoming ones show the kickoff time. Clickable
 * to feature a match.
 */
export function MatchCard({
  group, round, state, status, teamA, teamB, selected = false,
  onClick, onMouseEnter, onMouseLeave, className
}: MatchCardProps) {
  const badge = round ? (ROUND_LABELS[round] ?? round) : `GROUP ${group}`;
  const final = state === 'final';
  const aWin = final && (teamA.score ?? 0) > (teamB.score ?? 0);
  const bWin = final && (teamB.score ?? 0) > (teamA.score ?? 0);

  const row = (t: MatchTeam, win: boolean) => (
    <div className="mun-matchcard__row">
      <span className="mun-matchcard__team">
        <Flag code={t.code} size="sm" />
        <span className="mun-matchcard__code">{t.code}</span>
        <span className="mun-matchcard__name">{t.name}</span>
      </span>
      <span className="mun-matchcard__score" data-win={win || undefined}>
        {final ? t.score : ''}
      </span>
    </div>
  );

  return (
    <div
      className={['mun-matchcard', className].filter(Boolean).join(' ')}
      data-selected={selected || undefined}
      onClick={onClick}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      role={onClick ? 'button' : undefined}
    >
      <div className="mun-matchcard__head">
        <span className="mun-matchcard__group">{badge}</span>
        <span className="mun-matchcard__status" data-upcoming={!final || undefined}>{status}</span>
      </div>
      {row(teamA, aWin)}
      {row(teamB, bWin)}
    </div>
  );
}
