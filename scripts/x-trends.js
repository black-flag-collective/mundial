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
 * (default 800 requests/UTC-day), X_TRENDS_WOEIDS (comma-separated overrides),
 * X_TRENDS_AMBIENT_CAP (default 0.3 — ceiling for the ambient globe glow this
 * feeds the buzz engine; 0 disables it).
 *
 * Besides serving /api/trends.json, when given an `engine` ref this also feeds a
 * low per-nation **ambient** glow into the buzz engine (engine.setAmbient) so
 * nations trending on X breathe on the globe between matches — derived from the
 * trends we already pulled, so it costs zero extra requests.
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

// Reverse lookup: lowercased nation name / alias / "#code" -> FIFA code, longest
// needle first so the most specific match wins (e.g. "south korea" before "korea").
const NAME_TO_CODE = (() => {
  const pairs = [];
  for (const code of Object.keys(CODE_NAME)) {
    pairs.push([CODE_NAME[code].toLowerCase(), code]);
    pairs.push(['#' + code.toLowerCase(), code]);
    for (const a of ALIASES[code] || []) pairs.push([a.toLowerCase(), code]);
  }
  pairs.sort((a, b) => b[0].length - a[0].length);
  return pairs;
})();

/** Attribute a trend name to a FIFA code (the most specific nation it mentions). */
function codeForTrend(name) {
  if (!name) return null;
  const t = String(name).toLowerCase();
  for (const [needle, code] of NAME_TO_CODE) if (needle && t.includes(needle)) return code;
  return null;
}

/**
 * Derive a low per-nation **ambient** glow from the trends snapshot — fed to the
 * buzz engine's ambient channel so nations trending on X breathe on the globe
 * even when no match is live. Uses data we already polled (zero extra requests):
 * for each World-Cup-relevant trend that maps to a nation, take its post count
 * (max across locations, so a worldwide+host duplicate isn't double-counted),
 * then normalize and clamp to `cap` so ambient stays a gentle floor that a live
 * counts signal always outshines.
 */
function trendsToAmbient(locations, cap = 0.3) {
  const byCode = {};
  for (const loc of locations || []) {
    for (const tr of (loc && loc.trends) || []) {
      if (!tr || !tr.wc) continue;
      const code = codeForTrend(tr.name);
      if (!code) continue;
      const c = tr.postCount | 0;
      if (c > (byCode[code] || 0)) byCode[code] = c;
    }
  }
  const codes = Object.keys(byCode);
  if (!codes.length) return {};
  const max = Math.max(1, ...codes.map((c) => byCode[c]));
  const floor = {};
  for (const code of codes) {
    const f = Math.min(cap, Math.sqrt(byCode[code] / max) * cap);
    if (f > 0) floor[code] = Math.round(f * 1000) / 1000;
  }
  return floor;
}

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
function createTrendsPoller({ log = console, woeids, engine } = {}) {
  const INTERVAL = Number(process.env.X_TRENDS_INTERVAL_MS) || 600_000;
  const DAILY_CAP = Number(process.env.X_TRENDS_DAILY_CAP) || 800;
  const LOCATIONS = woeids || parseWoeidEnv(process.env.X_TRENDS_WOEIDS) || DEFAULT_WOEIDS;
  // Cap for the ambient glow trends feed into the buzz engine (0 disables it).
  const AMBIENT_CAP = process.env.X_TRENDS_AMBIENT_CAP != null ? Number(process.env.X_TRENDS_AMBIENT_CAP) : 0.3;

  let day = utcDay();
  const stats = {
    enabled: false,
    tokenConfigured: !!process.env.X_BEARER_TOKEN,
    locations: LOCATIONS.length,
    requestsToday: 0,
    dailyCap: DAILY_CAP,
    capped: false,
    intervalMs: INTERVAL,
    ambientCap: AMBIENT_CAP,
    ambientCount: 0,
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
      return { ok: false, trends: [] };
    }
    const body = await r.json().catch(() => ({}));
    return { ok: true, trends: parseTrends(body) };
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
    let okCount = 0;
    for (const loc of LOCATIONS) {
      const res = await fetchTrendsFor(loc.woeid);
      if (res.ok) okCount++;
      stats.requestsToday++;
      locations.push({ woeid: loc.woeid, name: loc.name, trends: res.trends });
    }
    snap = { updatedAt: new Date().toISOString(), source: 'x-trends', locations };
    stats.lastPollMs = Date.now();
    const wcCount = locations.reduce((n, l) => n + l.trends.filter((t) => t.wc).length, 0);

    // Feed a low ambient glow into the buzz engine (zero extra requests — derived
    // from the trends we just pulled), so nations trending on X light up the globe
    // even between matches. A live counts signal always outshines this floor.
    // Only overwrite the floor when at least one location actually responded: a
    // total outage (every location errored) holds the last floor rather than
    // blanking the globe, while a clean poll with no WC trends clears it honestly.
    if (engine && engine.setAmbient && AMBIENT_CAP > 0 && okCount > 0) {
      const floor = trendsToAmbient(locations, AMBIENT_CAP);
      engine.setAmbient(floor);
      stats.ambientCount = Object.keys(floor).length;
    }

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

module.exports = { createTrendsPoller, parseTrends, isWorldCupTrend, codeForTrend, trendsToAmbient, DEFAULT_WOEIDS };
