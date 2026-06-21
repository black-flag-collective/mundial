'use strict';

/**
 * X Trends — what's actually trending right now, per location.
 *
 * Uses the v2 `GET /2/trends/by_woeid/{woeid}` endpoint (app-only Bearer auth),
 * which returns trend names + post counts for a place. Unlike the per-team counts
 * poller, this is billed **per location**, so polling worldwide + the three host
 * nations is only a handful of requests per cycle — trivially cheap and separate
 * from the 48-team counts budget. It adds the "what the world is watching"
 * dimension on top of the "how loud is each nation" volume signal.
 *
 * Off unless `X_BEARER_TOKEN` is set (and `X_TRENDS_DISABLED` isn't `1`).
 * Tunables: X_TRENDS_INTERVAL_MS (default 600000=10m), X_TRENDS_DAILY_CAP
 * (default 800 requests/UTC-day), X_TRENDS_WOEIDS (comma-separated overrides).
 *
 * Docs: https://docs.x.com/x-api/trends/get-trends-by-woeid
 */

const { CODE_NAME, ALIASES } = require('./x-build-rules');

const TRENDS_URL = 'https://api.x.com/2/trends/by_woeid';

// Default locations: worldwide + the 2026 host nations. WOEIDs are the standard
// "Where On Earth" ids; override with X_TRENDS_WOEIDS if X's list changes.
const DEFAULT_WOEIDS = [
  { woeid: 1, name: 'Worldwide' },
  { woeid: 23424977, name: 'United States' },
  { woeid: 23424900, name: 'Mexico' },
  { woeid: 23424775, name: 'Canada' },
];

// Lowercased nation names + aliases, for tagging which trends are football/WC.
const WC_NAMES = (() => {
  const set = new Set();
  for (const code of Object.keys(CODE_NAME)) {
    set.add(CODE_NAME[code].toLowerCase());
    for (const a of ALIASES[code] || []) set.add(a.toLowerCase());
    set.add('#' + code.toLowerCase());
  }
  return set;
})();
const WC_KEYWORDS = ['world cup', 'worldcup', 'fifa', 'fwc', '#wc26', 'wc2026'];

/** Does a trend look World-Cup relevant (a nation, a #CODE, or a WC keyword)? */
function isWorldCupTrend(name, names = WC_NAMES) {
  if (!name) return false;
  const t = String(name).toLowerCase();
  for (const kw of WC_KEYWORDS) if (t.includes(kw)) return true;
  for (const n of names) if (n && t.includes(n)) return true;
  return false;
}

/** Parse the trends response body → [{ name, postCount, wc }]. */
function parseTrends(body) {
  const data = (body && Array.isArray(body.data)) ? body.data : [];
  return data
    .map((t) => ({ name: t.trend_name || t.name || '', postCount: (t.tweet_count | 0) || 0 }))
    .filter((t) => t.name)
    .map((t) => ({ ...t, wc: isWorldCupTrend(t.name) }));
}

const utcDay = () => new Date().toISOString().slice(0, 10);

function parseWoeidEnv(raw) {
  if (!raw) return null;
  const ids = raw.split(',').map((s) => Number(s.trim())).filter((n) => Number.isFinite(n) && n > 0);
  return ids.length ? ids.map((woeid) => ({ woeid, name: String(woeid) })) : null;
}

/**
 * Build the trends poller. Returns { start(signal), stats(), snapshot(), cycle() }.
 * snapshot() backs GET /api/trends.json; stats() is light telemetry.
 */
function createTrendsPoller({ log = console, woeids } = {}) {
  const INTERVAL = Number(process.env.X_TRENDS_INTERVAL_MS) || 600_000;
  const DAILY_CAP = Number(process.env.X_TRENDS_DAILY_CAP) || 800;
  const LOCATIONS = woeids || parseWoeidEnv(process.env.X_TRENDS_WOEIDS) || DEFAULT_WOEIDS;

  let day = utcDay();
  const stats = {
    enabled: false,
    tokenConfigured: !!process.env.X_BEARER_TOKEN,
    locations: LOCATIONS.length,
    requestsToday: 0,
    dailyCap: DAILY_CAP,
    capped: false,
    intervalMs: INTERVAL,
    errors: 0,
    lastPollMs: null,
    lastEvent: 'idle',
  };
  let snap = { updatedAt: null, source: 'x-trends', locations: [] };

  async function fetchTrendsFor(woeid) {
    const url = `${TRENDS_URL}/${woeid}?trend.fields=trend_name,tweet_count`;
    const r = await fetch(url, { headers: { Authorization: `Bearer ${process.env.X_BEARER_TOKEN}` } });
    if (!r.ok) {
      stats.errors++;
      stats.lastEvent = `trends HTTP ${r.status}`;
      return [];
    }
    const body = await r.json().catch(() => ({}));
    return parseTrends(body);
  }

  async function cycle() {
    if (utcDay() !== day) { day = utcDay(); stats.requestsToday = 0; stats.capped = false; }

    // Circuit breaker: don't start a cycle we can't finish within the cap.
    if (stats.requestsToday + LOCATIONS.length > DAILY_CAP) {
      stats.capped = true;
      stats.lastEvent = `daily cap ${DAILY_CAP} reached — paused until UTC reset`;
      return;
    }
    stats.capped = false;

    const locations = [];
    for (const loc of LOCATIONS) {
      const trends = await fetchTrendsFor(loc.woeid);
      stats.requestsToday++;
      locations.push({ woeid: loc.woeid, name: loc.name, trends });
    }
    snap = { updatedAt: new Date().toISOString(), source: 'x-trends', locations };
    stats.lastPollMs = Date.now();
    const wcCount = locations.reduce((n, l) => n + l.trends.filter((t) => t.wc).length, 0);
    stats.lastEvent = `polled ${LOCATIONS.length} location(s) · ${wcCount} World-Cup trend(s)`;
  }

  function start(signal) {
    if (!process.env.X_BEARER_TOKEN) {
      log.warn('[x-trends] X_BEARER_TOKEN not set — trends disabled');
      return;
    }
    if (process.env.X_TRENDS_DISABLED === '1') {
      log.warn('[x-trends] X_TRENDS_DISABLED=1 — trends disabled');
      return;
    }
    stats.enabled = true;
    stats.lastEvent = 'starting…';
    const run = () => cycle().catch((e) => { stats.errors++; stats.lastEvent = 'cycle error: ' + e.message; log.error('[x-trends]', e.message); });
    run();
    const id = setInterval(() => {
      if (signal && signal.aborted) { clearInterval(id); return; }
      run();
    }, INTERVAL);
    if (id.unref) id.unref();
    if (signal && signal.addEventListener) {
      signal.addEventListener('abort', () => { clearInterval(id); stats.enabled = false; });
    }
  }

  return { start, stats: () => ({ ...stats }), snapshot: () => snap, cycle };
}

module.exports = { createTrendsPoller, parseTrends, isWorldCupTrend, DEFAULT_WOEIDS };
