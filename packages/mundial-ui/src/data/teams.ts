import type { Confederation } from './confederations';

export interface Team {
  name: string;
  /** FIFA 3-letter code. */
  code: string;
  /** Group letter A–L. */
  group: string;
  confed: Confederation;
  /** Latitude/longitude (used to place the team on the globe). */
  lat: number;
  lon: number;
}

/** The 48 qualified nations of the 2026 World Cup. */
export const TEAMS: Team[] = [
  { name: 'Mexico', code: 'MEX', group: 'A', confed: 'CONCACAF', lat: 23.6, lon: -102.5 },
  { name: 'South Africa', code: 'RSA', group: 'A', confed: 'CAF', lat: -30.6, lon: 22.9 },
  { name: 'South Korea', code: 'KOR', group: 'A', confed: 'AFC', lat: 36.5, lon: 127.8 },
  { name: 'Czechia', code: 'CZE', group: 'A', confed: 'UEFA', lat: 49.8, lon: 15.5 },
  { name: 'Canada', code: 'CAN', group: 'B', confed: 'CONCACAF', lat: 56.1, lon: -106.3 },
  { name: 'Switzerland', code: 'SUI', group: 'B', confed: 'UEFA', lat: 46.8, lon: 8.2 },
  { name: 'Qatar', code: 'QAT', group: 'B', confed: 'AFC', lat: 25.3, lon: 51.2 },
  { name: 'Bosnia & Herzegovina', code: 'BIH', group: 'B', confed: 'UEFA', lat: 43.9, lon: 17.7 },
  { name: 'Brazil', code: 'BRA', group: 'C', confed: 'CONMEBOL', lat: -14.2, lon: -51.9 },
  { name: 'Morocco', code: 'MAR', group: 'C', confed: 'CAF', lat: 31.8, lon: -7.1 },
  { name: 'Haiti', code: 'HAI', group: 'C', confed: 'CONCACAF', lat: 19.0, lon: -72.3 },
  { name: 'Scotland', code: 'SCO', group: 'C', confed: 'UEFA', lat: 56.5, lon: -4.2 },
  { name: 'United States', code: 'USA', group: 'D', confed: 'CONCACAF', lat: 39.8, lon: -98.6 },
  { name: 'Paraguay', code: 'PAR', group: 'D', confed: 'CONMEBOL', lat: -23.4, lon: -58.4 },
  { name: 'Australia', code: 'AUS', group: 'D', confed: 'AFC', lat: -25.3, lon: 133.8 },
  { name: 'Türkiye', code: 'TUR', group: 'D', confed: 'UEFA', lat: 39.0, lon: 35.2 },
  { name: 'Germany', code: 'GER', group: 'E', confed: 'UEFA', lat: 51.2, lon: 10.5 },
  { name: 'Curaçao', code: 'CUW', group: 'E', confed: 'CONCACAF', lat: 12.2, lon: -69.0 },
  { name: "Côte d'Ivoire", code: 'CIV', group: 'E', confed: 'CAF', lat: 7.5, lon: -5.5 },
  { name: 'Ecuador', code: 'ECU', group: 'E', confed: 'CONMEBOL', lat: -1.8, lon: -78.2 },
  { name: 'Netherlands', code: 'NED', group: 'F', confed: 'UEFA', lat: 52.1, lon: 5.3 },
  { name: 'Japan', code: 'JPN', group: 'F', confed: 'AFC', lat: 36.2, lon: 138.3 },
  { name: 'Tunisia', code: 'TUN', group: 'F', confed: 'CAF', lat: 33.9, lon: 9.6 },
  { name: 'Sweden', code: 'SWE', group: 'F', confed: 'UEFA', lat: 60.1, lon: 18.6 },
  { name: 'Belgium', code: 'BEL', group: 'G', confed: 'UEFA', lat: 50.5, lon: 4.5 },
  { name: 'Egypt', code: 'EGY', group: 'G', confed: 'CAF', lat: 26.8, lon: 30.8 },
  { name: 'Iran', code: 'IRN', group: 'G', confed: 'AFC', lat: 32.4, lon: 53.7 },
  { name: 'New Zealand', code: 'NZL', group: 'G', confed: 'OFC', lat: -40.9, lon: 174.9 },
  { name: 'Spain', code: 'ESP', group: 'H', confed: 'UEFA', lat: 40.5, lon: -3.7 },
  { name: 'Cabo Verde', code: 'CPV', group: 'H', confed: 'CAF', lat: 16.0, lon: -24.0 },
  { name: 'Saudi Arabia', code: 'KSA', group: 'H', confed: 'AFC', lat: 24.0, lon: 45.0 },
  { name: 'Uruguay', code: 'URU', group: 'H', confed: 'CONMEBOL', lat: -33.0, lon: -56.0 },
  { name: 'France', code: 'FRA', group: 'I', confed: 'UEFA', lat: 46.2, lon: 2.2 },
  { name: 'Senegal', code: 'SEN', group: 'I', confed: 'CAF', lat: 14.5, lon: -14.5 },
  { name: 'Norway', code: 'NOR', group: 'I', confed: 'UEFA', lat: 60.5, lon: 8.5 },
  { name: 'Iraq', code: 'IRQ', group: 'I', confed: 'AFC', lat: 33.2, lon: 43.7 },
  { name: 'Argentina', code: 'ARG', group: 'J', confed: 'CONMEBOL', lat: -38.4, lon: -63.6 },
  { name: 'Algeria', code: 'ALG', group: 'J', confed: 'CAF', lat: 28.0, lon: 1.7 },
  { name: 'Austria', code: 'AUT', group: 'J', confed: 'UEFA', lat: 47.5, lon: 14.6 },
  { name: 'Jordan', code: 'JOR', group: 'J', confed: 'AFC', lat: 30.6, lon: 36.2 },
  { name: 'Portugal', code: 'POR', group: 'K', confed: 'UEFA', lat: 39.4, lon: -8.2 },
  { name: 'Uzbekistan', code: 'UZB', group: 'K', confed: 'AFC', lat: 41.4, lon: 64.6 },
  { name: 'Colombia', code: 'COL', group: 'K', confed: 'CONMEBOL', lat: 4.6, lon: -74.3 },
  { name: 'DR Congo', code: 'COD', group: 'K', confed: 'CAF', lat: -4.0, lon: 21.8 },
  { name: 'England', code: 'ENG', group: 'L', confed: 'UEFA', lat: 52.4, lon: -1.5 },
  { name: 'Croatia', code: 'CRO', group: 'L', confed: 'UEFA', lat: 45.1, lon: 15.2 },
  { name: 'Ghana', code: 'GHA', group: 'L', confed: 'CAF', lat: 7.9, lon: -1.0 },
  { name: 'Panama', code: 'PAN', group: 'L', confed: 'CONCACAF', lat: 8.5, lon: -80.0 }
];

/** Lookup by FIFA code. */
export const TEAM_BY_CODE: Record<string, Team> = Object.fromEntries(
  TEAMS.map((t) => [t.code, t])
);

/** Full name for a FIFA code, or the code itself if unknown. */
export function teamName(code: string): string {
  return TEAM_BY_CODE[code]?.name ?? code;
}
