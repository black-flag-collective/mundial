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

const SHORT_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const LONG_MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const DOW = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/**
 * Format an ISO timestamp to the app's day label, e.g. "Jun 19". Formatted in
 * UTC to match how the seed data already groups matches by `ko` (a UTC ISO
 * string) — using local time could shift a late-night kickoff to the wrong day.
 */
function toDayShort(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return `${SHORT_MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}`;
}

/** Long form, e.g. "June 19" (UTC). */
function toDayLong(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return `${LONG_MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}`;
}

/** Day of week, e.g. "Friday" (UTC). */
function toDow(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return DOW[d.getUTCDay()];
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

module.exports = { toDayShort, toDayLong, toDow, mapStatus, normalizeGroup };
