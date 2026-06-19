import './BracketMatch.css';
import { Flag } from '../Flag/Flag';

export interface BracketTeam {
  code: string;
  name: string;
  /** Marks the projected/actual winner — brightened, with the accent bar. */
  winner?: boolean;
}

export interface BracketMatchProps {
  teamA: BracketTeam;
  teamB: BracketTeam;
  /** 'sm' for the column cells, 'lg' for the final. Default 'sm'. */
  size?: 'sm' | 'lg';
  onMouseEnter?: () => void;
  onMouseLeave?: () => void;
  onClick?: () => void;
  className?: string;
}

/**
 * A single knockout pairing. The winning side is brightened with an accent
 * edge bar; the losing side dims. Used across every bracket round (and, at
 * size="lg", for the final inside <ChampionCard>).
 */
export function BracketMatch({
  teamA, teamB, size = 'sm', onMouseEnter, onMouseLeave, onClick, className
}: BracketMatchProps) {
  const side = (t: BracketTeam) => (
    <div className="mun-bracket-match__side" data-winner={t.winner || undefined}>
      <Flag code={t.code} size={size === 'lg' ? 'md' : 'sm'} />
      <span className="mun-bracket-match__code">{t.code}</span>
      <span className="mun-bracket-match__name">{t.name}</span>
    </div>
  );
  return (
    <div
      className={['mun-bracket-match', `mun-bracket-match--${size}`, className].filter(Boolean).join(' ')}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      onClick={onClick}
      role={onClick ? 'button' : undefined}
    >
      {side(teamA)}
      <div className="mun-bracket-match__divider" />
      {side(teamB)}
    </div>
  );
}
