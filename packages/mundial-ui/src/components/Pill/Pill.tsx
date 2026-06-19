import './Pill.css';
import type { ReactNode } from 'react';

export interface PillProps {
  /** Whether this pill is the active/selected one. */
  active?: boolean;
  onClick?: () => void;
  children: ReactNode;
  className?: string;
}

/**
 * A single segmented-control pill. Compose several inside <NavPills>, or use
 * standalone. Active pills get a translucent fill and brighten to full white.
 */
export function Pill({ active = false, onClick, children, className }: PillProps) {
  return (
    <button
      type="button"
      className={['mun-pill', className].filter(Boolean).join(' ')}
      data-active={active || undefined}
      aria-pressed={active}
      onClick={onClick}
    >
      {children}
    </button>
  );
}
