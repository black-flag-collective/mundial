/** The six FIFA confederations, with the design system's accent color each. */
export type Confederation = 'AFC' | 'CAF' | 'CONCACAF' | 'CONMEBOL' | 'OFC' | 'UEFA';

export interface ConfederationInfo {
  label: string;
  /** Marker/accent color (matches the --mun-confed-* tokens). */
  color: string;
}

export const CONFEDERATIONS: Record<Confederation, ConfederationInfo> = {
  AFC: { label: 'AFC', color: '#ff7fb0' },
  CAF: { label: 'CAF', color: '#ffd35c' },
  CONCACAF: { label: 'CONCACAF', color: '#ff8a5c' },
  CONMEBOL: { label: 'CONMEBOL', color: '#5fe0a0' },
  OFC: { label: 'OFC', color: '#5fd4e0' },
  UEFA: { label: 'UEFA', color: '#6ea8ff' }
};

/** Ordered list, handy for legends. */
export const CONFEDERATION_LIST: ConfederationInfo[] = Object.values(CONFEDERATIONS);
