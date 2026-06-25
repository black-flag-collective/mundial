import './FeaturedMatch.css';
import { Flag } from '../Flag/Flag';
import { StatusBadge } from '../StatusBadge/StatusBadge';

const ROUND_LABELS: Record<string, string> = {
  R32: 'Round of 32', R16: 'Round of 16', QF: 'Quarter-final',
  SF: 'Semi-final', '3P': 'Third place', F: 'Final',
};

export interface FeaturedMatchProps {
  /** Group letter (group-stage ties). */
  group?: string;
  /** Knockout round code (R32/R16/QF/SF/3P/F). Shown instead of the group label. */
  round?: string;
  teamA: { code: string; name: string };
  teamB: { code: string; name: string };
  /** 'final' shows the score; 'upcoming' shows "vs". */
  state: 'final' | 'upcoming';
  /** Score line for a finished match, e.g. "3 – 1". Ignored when upcoming. */
  score?: string;
  /** Status pill label — defaults to "Full Time" / "Kick-off". */
  status?: string;
  venue?: string;
  className?: string;
}

/**
 * The hero treatment for the day's featured match: oversized team codes with
 * the score between them, flags + full names beneath, and a status pill.
 */
export function FeaturedMatch({
  group, round, teamA, teamB, state, score, status, venue, className
}: FeaturedMatchProps) {
  const final = state === 'final';
  const badge = round ? (ROUND_LABELS[round] ?? round) : `Group ${group}`;
  return (
    <div className={['mun-featured', className].filter(Boolean).join(' ')}>
      <span className="mun-featured__group">{badge}</span>
      <div className="mun-featured__score-line">
        <span className="mun-featured__code">{teamA.code}</span>
        <span className="mun-featured__score" data-final={final || undefined}>
          {final ? (score ?? '') : 'vs'}
        </span>
        <span className="mun-featured__code">{teamB.code}</span>
      </div>
      <div className="mun-featured__names">
        <span className="mun-featured__name">
          <Flag code={teamA.code} size="md" />{teamA.name}
        </span>
        <span className="mun-featured__dot">·</span>
        <span className="mun-featured__name">
          {teamB.name}<Flag code={teamB.code} size="md" />
        </span>
      </div>
      <div className="mun-featured__meta">
        <StatusBadge variant={final ? 'final' : 'upcoming'}>
          {status ?? (final ? 'Full Time' : 'Kick-off')}
        </StatusBadge>
        {venue && <span className="mun-featured__venue">{venue}</span>}
      </div>
    </div>
  );
}
