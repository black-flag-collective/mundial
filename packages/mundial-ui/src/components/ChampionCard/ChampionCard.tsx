import './ChampionCard.css';
import { BracketMatch, type BracketTeam } from '../BracketMatch/BracketMatch';

export interface ChampionCardProps {
  final: {
    teamA: BracketTeam;
    teamB: BracketTeam;
    onMouseEnter?: () => void;
    onMouseLeave?: () => void;
    onClick?: () => void;
  };
  champion: { code: string; name: string };
  className?: string;
}

/**
 * The centerpiece of the bracket: the FINAL pairing above the projected
 * champion's oversized code + name.
 */
export function ChampionCard({ final, champion, className }: ChampionCardProps) {
  return (
    <div className={['mun-champion', className].filter(Boolean).join(' ')}>
      <span className="mun-champion__label">FINAL</span>
      <BracketMatch
        size="lg"
        teamA={final.teamA}
        teamB={final.teamB}
        onMouseEnter={final.onMouseEnter}
        onMouseLeave={final.onMouseLeave}
        onClick={final.onClick}
      />
      <div className="mun-champion__crown">
        <span className="mun-champion__caption">PROJECTED CHAMPION</span>
        <span className="mun-champion__code">{champion.code}</span>
        <span className="mun-champion__name">{champion.name}</span>
      </div>
    </div>
  );
}
