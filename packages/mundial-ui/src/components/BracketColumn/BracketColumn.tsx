import './BracketColumn.css';
import type { ReactNode } from 'react';

export interface BracketColumnProps {
  /** Round label, e.g. "R32", "R16", "QF", "SF". */
  label: string;
  children: ReactNode;
  className?: string;
}

/**
 * A labeled column of <BracketMatch> cells, evenly distributed — one round of
 * the knockout tree.
 */
export function BracketColumn({ label, children, className }: BracketColumnProps) {
  return (
    <div className={['mun-bracket-col', className].filter(Boolean).join(' ')}>
      <span className="mun-bracket-col__label">{label}</span>
      <div className="mun-bracket-col__matches">{children}</div>
    </div>
  );
}
