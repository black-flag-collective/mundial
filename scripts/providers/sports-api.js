'use strict';

/**
 * Structured football-results provider — the PRIMARY source.
 *
 * Default implementation targets football-data.org v4
 * (GET /competitions/{COMP}/matches), whose free tier includes the FIFA World
 * Cup. It maps structured fixtures → the normalized { new_days, updated_matches }
 * shape mergeUpdate() consumes. No LLM, no prose parsing, no hallucinated scores.
 *
 * Switching to another API (e.g. API-Football / api-sports.io) is a drop-in:
 * point SPORTS_API_URL at it, set the token, and adjust the per-match field reads
 * in mapFixtures(). The contract and everything downstream stay identical.
 *
 * Safety: any fixture whose two teams don't BOTH resolve to our FIFA codes is
 * dropped with a warning (never guessed) — a wrong code would render a broken
 * flag and poison the derived standings/bracket. mergeUpdate() additionally
 * guarantees confirmed finals are never overwritten, so even a mistimed LIVE
 * from the API can't corrupt good data.
 */

const { toFifa } = require('./team-codes');
const { toDayShort, toDayLong, toDow, mapStatus, normalizeGroup } = require('./provider');

/**
 * Map a list of football-data.org fixtures → { new_days, updated_matches }.
 *
 * Every resolvable fixture is emitted into BOTH:
 *  - new_days       — so a fixture not yet in the data gets added (mergeUpdate
 *                     dedupes by team-pair, so existing fixtures are skipped).
 *  - updated_matches — so an existing UP fixture is promoted to its FT/LIVE score
 *                     (mergeUpdate only patches non-final matches).
 * This double-emit lets one structured response both schedule and score matches.
 */
function mapFixtures(fixtures, log = console) {
  const dayMap = new Map(); // day_short -> { day_short, day_long, day_dow, matches: [] }
  const updated = [];
  let dropped = 0;

  for (const fx of fixtures || []) {
    const home = fx.homeTeam || {};
    const away = fx.awayTeam || {};
    const a = toFifa(home.tla, home.shortName, home.name);
    const b = toFifa(away.tla, away.shortName, away.name);
    if (!a || !b) { dropped++; continue; } // unmappable team → drop, never guess

    const ko = fx.utcDate;
    const short = toDayShort(ko);
    if (!short) { dropped++; continue; }

    const st = mapStatus(fx.status);
    const g = normalizeGroup(fx.group || fx.stage) || undefined;
    const ft = (fx.score && fx.score.fullTime) || {};

    const match = { g, a, b, st, ko };
    if (st === 'FT' || st === 'LIVE') {
      match.as = Number.isInteger(ft.home) ? ft.home : 0;
      match.bs = Number.isInteger(ft.away) ? ft.away : 0;
      updated.push({ day_short: short, a, b, as: match.as, bs: match.bs, st });
    }

    if (!dayMap.has(short)) {
      dayMap.set(short, { day_short: short, day_long: toDayLong(ko), day_dow: toDow(ko), matches: [] });
    }
    dayMap.get(short).matches.push(match);
  }

  if (dropped) {
    (log.warn || console.warn)(`[update] football-data.org: dropped ${dropped} fixture(s) with unresolved teams/dates.`);
  }
  return { new_days: [...dayMap.values()], updated_matches: updated };
}

/**
 * Create the sports-API provider. `fetch` is injectable for tests; `token` gates
 * availability. baseUrl/competition are env-overridable so the source can be
 * retargeted without code changes.
 */
function createSportsApiProvider({
  fetch: fetchImpl = globalThis.fetch,
  token = process.env.FOOTBALL_DATA_TOKEN,
  baseUrl = process.env.SPORTS_API_URL || 'https://api.football-data.org/v4',
  competition = process.env.SPORTS_API_COMPETITION || 'WC',
  log = console,
} = {}) {
  return {
    name: 'football-data.org',
    isAvailable() { return !!token && typeof fetchImpl === 'function'; },
    async fetchUpdate() {
      const url = `${baseUrl}/competitions/${competition}/matches`;
      let res;
      try {
        res = await fetchImpl(url, { headers: { 'X-Auth-Token': token } });
      } catch (err) {
        (log.warn || console.warn)(`[update] football-data.org: fetch failed (${err && err.message}). Skipping this source.`);
        return null; // couldn't run → let the chain fall through to the fallback
      }
      if (!res || !res.ok) {
        (log.warn || console.warn)(`[update] football-data.org: HTTP ${res && res.status}. Skipping this source.`);
        return null;
      }
      let body;
      try { body = await res.json(); } catch (err) {
        (log.warn || console.warn)(`[update] football-data.org: invalid JSON (${err && err.message}). Skipping.`);
        return null;
      }
      const fixtures = Array.isArray(body && body.matches) ? body.matches : [];
      return mapFixtures(fixtures, log);
    },
  };
}

module.exports = { createSportsApiProvider, mapFixtures };
