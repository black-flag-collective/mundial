'use strict';

/**
 * Single source of truth for the 48 FIFA 3-letter team codes the app renders,
 * plus the mapping from a real sports API's team identifiers to those codes.
 *
 * Why a mapping layer exists: a structured football API (football-data.org,
 * API-Football, …) returns its OWN team names / abbreviations, which do not
 * always equal the FIFA codes the globe and flags are keyed on. A wrong code
 * renders a broken flag and can poison the derived standings/bracket, so the
 * sports provider DROPS any fixture whose teams don't both resolve here — it
 * never guesses (see scripts/providers/sports-api.js).
 */

const TEAM_CODES = [
  'MEX', 'RSA', 'KOR', 'CZE', 'CAN', 'SUI', 'QAT', 'BIH',
  'BRA', 'MAR', 'HAI', 'SCO', 'USA', 'PAR', 'AUS', 'TUR',
  'GER', 'CUW', 'CIV', 'ECU', 'NED', 'JPN', 'TUN', 'SWE',
  'BEL', 'EGY', 'IRN', 'NZL', 'ESP', 'CPV', 'KSA', 'URU',
  'FRA', 'SEN', 'NOR', 'IRQ', 'ARG', 'ALG', 'AUT', 'JOR',
  'POR', 'UZB', 'COL', 'COD', 'ENG', 'CRO', 'GHA', 'PAN',
];

const CODE_SET = new Set(TEAM_CODES);

/**
 * Overrides for tokens that differ from our FIFA code. Keys are UPPERCASED API
 * values (a `tla`/abbreviation or a full team name); values are our canonical
 * codes. Extend this as real API responses reveal mismatches — the self-test
 * guarantees every emitted code is one of TEAM_CODES regardless.
 */
const ALIASES = {
  // Full names (football-data.org exposes `name`)
  'SOUTH AFRICA': 'RSA',
  'SOUTH KOREA': 'KOR',
  'KOREA REPUBLIC': 'KOR',
  'REPUBLIC OF KOREA': 'KOR',
  IRAN: 'IRN',
  'IR IRAN': 'IRN',
  'SAUDI ARABIA': 'KSA',
  CURACAO: 'CUW',
  'CAPE VERDE': 'CPV',
  'CABO VERDE': 'CPV',
  'CONGO DR': 'COD',
  'DR CONGO': 'COD',
  'DEMOCRATIC REPUBLIC OF CONGO': 'COD',
  'IVORY COAST': 'CIV',
  "COTE D'IVOIRE": 'CIV',
  'COTE DIVOIRE': 'CIV',
  'BOSNIA AND HERZEGOVINA': 'BIH',
  'BOSNIA-HERZEGOVINA': 'BIH',
  TURKEY: 'TUR',
  TURKIYE: 'TUR',
  'TÜRKIYE': 'TUR',
  // Abbreviation overrides (where a provider's tla isn't our FIFA code).
  // Saudi Arabia (KSA) already equals our FIFA code, so it resolves directly —
  // no alias needed. Do NOT alias RKS here: RKS is Kosovo's code, and mapping it
  // to KSA would silently mislabel Kosovo as Saudi Arabia. An unrecognized token
  // returns null → the fixture is dropped, which is the correct "never guess".
  ZAF: 'RSA', // ISO-3166 alpha-3 for South Africa (our FIFA code is RSA)
};

/**
 * Resolve one or more API team tokens (its `tla`/abbreviation and/or full
 * `name`) to one of our 48 FIFA codes, or null if it can't be resolved
 * confidently. Tries each token in order: an exact FIFA-code match first, then
 * the alias table.
 */
function toFifa(...tokens) {
  for (const t of tokens) {
    if (!t) continue;
    const up = String(t).trim().toUpperCase();
    if (CODE_SET.has(up)) return up; // the abbreviation already is our code
    if (ALIASES[up]) return ALIASES[up];
  }
  return null;
}

module.exports = { TEAM_CODES, CODE_SET, ALIASES, toFifa };
