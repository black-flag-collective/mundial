import './Eyebrow.css';
import type { ReactNode } from 'react';

export interface EyebrowProps {
  children: ReactNode;
  /** Visual emphasis. "strong" is brighter; "subtle" is dimmer. Default "default". */
  tone?: 'default' | 'strong' | 'subtle';
  className?: string;
}

/**
 * Uppercase, wide-tracked kicker label — the small caption that sits above
 * headings throughout Mundial (e.g. "FIFA WORLD CUP 26 · GROUP STAGE").
 */
export function Eyebrow({ children, tone = 'default', className }: EyebrowProps) {
  return (
    <span
      className={['mun-eyebrow', `mun-eyebrow--${tone}`, className].filter(Boolean).join(' ')}
    >
      {children}
    </span>
  );
}
