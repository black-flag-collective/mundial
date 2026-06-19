import './FeaturedMatch.css';
import { Flag } from '../Flag/Flag';
import { StatusBadge } from '../StatusBadge/StatusBadge';

export interface FeaturedMatchProps {
  group: string;
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
  group, teamA, teamB, state, score, status, venue, className
}: FeaturedMatchProps) {
  const final = state === 'final';
  return (
    <div className={['mun-featured', className].filter(Boolean).join(' ')}>
      <span className="mun-featured__group">Group {group}</span>
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
