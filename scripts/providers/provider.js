'use strict';

/**
 * Pure helpers shared by data-source providers. Dependency-free and
 * side-effect-free so they unit-test directly.
 *
 * The ResultsProvider "interface" (documented here, enforced by duck-typing) is
 * intentionally tiny (Interface Segregation):
 *
 *   {
 *     name: string,
 *     isAvailable(): boolean,                       // is this source configured?
 *     async fetchUpdate(currentData):               // returns the SAME shape
 *       { new_days, updated_matches } | null        // mergeUpdate() consumes,
 *   }                                                // or null when it couldn't run
 *
 * Returning the normalized update shape (not raw API data) is what makes every
 * provider interchangeable (Liskov) and lets the orchestrator depend only on
 * this contract (Dependency Inversion).
 */

// Matchdays are grouped in US-Eastern, the natural "tournament day" for a
// CONCACAF-hosted World Cup: a 9pm-ET kickoff (≈ 01:00–02:00Z the next calendar
// day in UTC) belongs to that evening's matchday, not the following one. Using
// UTC would split a single night's slate across two day labels.
const TZ = 'America/New_York';
function partsET(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const fmt = new Intl.DateTimeFormat('en-US', { timeZone: TZ, weekday: 'long', month: 'short', day: 'numeric' });
  const p = {};
  for (const part of fmt.formatToParts(d)) p[part.type] = part.value;
  return p; // { weekday: 'Friday', month: 'Jun', day: '19' }
}

/** Day label, e.g. "Jun 19" (US-Eastern). */
function toDayShort(iso) {
  const p = partsET(iso);
  return p ? `${p.month} ${p.day}` : null;
}

/** Long form, e.g. "June 19" (US-Eastern). */
function toDayLong(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const month = new Intl.DateTimeFormat('en-US', { timeZone: TZ, month: 'long' }).format(d);
  const day = new Intl.DateTimeFormat('en-US', { timeZone: TZ, day: 'numeric' }).format(d);
  return `${month} ${day}`;
}

/** Day of week, e.g. "Friday" (US-Eastern). */
function toDow(iso) {
  const p = partsET(iso);
  return p ? p.weekday : null;
}

/**
 * Data-integrity invariant: a match cannot have a result before it kicks off.
 * Demote any FT/LIVE entry whose `ko` is still in the future back to UP and drop
 * its score. This self-heals fabricated/early results — which mergeUpdate's
 * FT-immutability would otherwise freeze permanently — so a structured provider
 * can fill the REAL result once the match is actually played. Mutates `data` in
 * place; returns the number of matches reset. Matches without a `ko` are left
 * untouched (their timing can't be verified).
 */
function demotePrematureResults(data, now = Date.now()) {
  let reset = 0;
  for (const day of (data && data.dayMatches) || []) {
    for (const m of day || []) {
      if ((m.st === 'FT' || m.st === 'LIVE') && m.ko) {
        const ko = Date.parse(m.ko);
        if (!Number.isNaN(ko) && ko > now) {
          m.st = 'UP';
          delete m.as;
          delete m.bs;
          reset++;
        }
      }
    }
  }
  return reset;
}

/** Normalize a sports-API status string to the app's st: FT | LIVE | UP. */
function mapStatus(apiStatus) {
  switch (String(apiStatus || '').toUpperCase()) {
    case 'FINISHED':
    case 'FT':
    case 'AET': // after extra time
    case 'PEN': // decided on penalties
      return 'FT';
    case 'IN_PLAY':
    case 'PAUSED':
    case 'LIVE':
    case 'HT': // half time
      return 'LIVE';
    default:
      return 'UP'; // TIMED / SCHEDULED / POSTPONED / SUSPENDED / unknown
  }
}

/** Normalize a group label like "GROUP_A" / "Group A" / "A" → "A" (or null). */
function normalizeGroup(g) {
  if (!g) return null;
  const m = String(g).toUpperCase().match(/([A-L])\s*$/);
  return m ? m[1] : null;
}

/**
 * Normalize a knockout stage to the app's round code, or null for the group
 * stage / unknown. Codes ascend through the bracket: R32 → R16 → QF → SF → 3P
 * (third-place playoff) → F (final). football-data.org uses LAST_16 etc.; we
 * also accept ROUND_OF_* and a few aliases so the mapping survives a provider swap.
 */
function mapStage(stage) {
  switch (String(stage || '').toUpperCase().replace(/[\s-]+/g, '_')) {
    case 'LAST_32':
    case 'ROUND_OF_32':
      return 'R32';
    case 'LAST_16':
    case 'ROUND_OF_16':
      return 'R16';
    case 'QUARTER_FINALS':
    case 'QUARTER_FINAL':
    case 'QUARTERFINALS':
      return 'QF';
    case 'SEMI_FINALS':
    case 'SEMI_FINAL':
    case 'SEMIFINALS':
      return 'SF';
    case 'THIRD_PLACE':
    case 'THIRD_PLACE_PLAYOFF':
    case 'PLAY_OFF_FOR_THIRD_PLACE':
      return '3P';
    case 'FINAL':
      return 'F';
    default:
      return null; // GROUP_STAGE / REGULAR_SEASON / unknown → not a knockout tie
  }
}

/** Human label for a round code, e.g. "R16" → "Round of 16". */
const ROUND_LABELS = {
  R32: 'Round of 32', R16: 'Round of 16', QF: 'Quarter-final',
  SF: 'Semi-final', '3P': 'Third place', F: 'Final',
};
function roundLabel(round) { return ROUND_LABELS[round] || round || ''; }

module.exports = { toDayShort, toDayLong, toDow, mapStatus, normalizeGroup, mapStage, roundLabel, ROUND_LABELS, demotePrematureResults };
