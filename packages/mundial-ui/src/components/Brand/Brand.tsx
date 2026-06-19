import './Brand.css';

export interface BrandProps {
  /** Glyph size in px (the wordmark scales with it). Default 26. */
  size?: number;
  /** Render only the mark, hiding the "Mundial" wordmark. Default false. */
  markOnly?: boolean;
  className?: string;
}

/**
 * The Mundial lockup: the angular mark plus the Playfair-italic "Mundial"
 * wordmark. Sits in the top-left of the app chrome.
 */
export function Brand({ size = 26, markOnly = false, className }: BrandProps) {
  return (
    <div className={['mun-brand', className].filter(Boolean).join(' ')}>
      <svg width={size} height={size} viewBox="0 0 256 256" fill="#ffffff" xmlns="http://www.w3.org/2000/svg" aria-hidden={!markOnly}>
        <path d="M 256 256 L 128 256 L 0 128 L 128 128 Z M 256 128 L 128 128 L 0 0 L 128 0 Z" />
      </svg>
      {!markOnly && (
        <span className="mun-brand__word" style={{ fontSize: Math.round(size * 0.92) }}>
          Mundial
        </span>
      )}
    </div>
  );
}
