import './StatusBadge.css';
import type { ReactNode } from 'react';

export type StatusVariant = 'final' | 'upcoming' | 'today';

export interface StatusBadgeProps {
  /** "final" (neutral glass), "upcoming" (accent), "today" (solid accent). */
  variant: StatusVariant;
  /** Label. Defaults: final→"Full Time", upcoming→"Kick-off", today→"TODAY". */
  children?: ReactNode;
  className?: string;
}

const DEFAULT_LABEL: Record<StatusVariant, string> = {
  final: 'Full Time',
  upcoming: 'Kick-off',
  today: 'TODAY'
};

/**
 * Pill that marks a match's state — a neutral "Full Time", an accent kick-off
 * time, or the solid-accent "TODAY" tag.
 */
export function StatusBadge({ variant, children, className }: StatusBadgeProps) {
  return (
    <span
      className={['mun-status', `mun-status--${variant}`, className].filter(Boolean).join(' ')}
    >
      {children ?? DEFAULT_LABEL[variant]}
    </span>
  );
}
