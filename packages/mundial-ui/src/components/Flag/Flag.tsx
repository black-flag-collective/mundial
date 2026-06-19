import './Flag.css';
import { flagUrl } from '../../lib/flags';

export type FlagSize = 'sm' | 'md' | 'lg' | 'xl';

export interface FlagProps {
  /** FIFA 3-letter team code, e.g. "BRA", "ENG". */
  code: string;
  /** Preset size. sm=20×14, md=28×19, lg=64×43, xl flag cards. Default "md". */
  size?: FlagSize;
  /** Accessible label. Defaults to the team code. */
  alt?: string;
  className?: string;
}

/**
 * Country flag image for a FIFA team code, sourced from flagcdn with the
 * design system's rounded corners + hairline border.
 */
export function Flag({ code, size = 'md', alt, className }: FlagProps) {
  const src = flagUrl(code, size === 'lg' || size === 'xl' ? 80 : 40);
  return (
    <img
      className={['mun-flag', `mun-flag--${size}`, className].filter(Boolean).join(' ')}
      src={src}
      alt={alt ?? code}
      loading="lazy"
    />
  );
}
