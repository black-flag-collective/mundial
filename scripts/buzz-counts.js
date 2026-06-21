'use strict';

/**
 * Cost-effective real-time buzz via the X v2 **counts** endpoint.
 *
 * Instead of the filtered-stream firehose (billed per post pulled — the ~$5/min
 * problem), this asks X only *how many* posts match per team and feeds that
 * volume into the buzz engine as a sustained per-country signal. No post bodies
 * are retrieved, so cost is bounded by request count, not match volume.
 *
 * Three guards (the strategy items):
 *   1. Counts, not stream — `GET /2/tweets/counts/recent` (volume only).
 *   2. Scoped — only the teams in *today's* matches (data/matches.json), and
 *      nothing when there are no matches today.
 *   3. Hard daily cap — a request budget with a circuit breaker that pauses
 *      polling (and lets buzz fade back to the free simulation) when hit.
 *
 * Off unless `X_BUZZ_MODE=counts` and `X_BEARER_TOKEN` are set. Tunables:
 *   X_COUNTS_INTERVAL_MS (default 300000=5m), X_COUNTS_WINDOW_MIN (default 10),
 *   X_COUNTS_DAILY_CAP   (default 2000 requests/UTC-day).
 *
 * Docs: https://docs.x.com/x-api/x-posts/recent-search-counts
 */

const fs = require('fs');
const path = require('path');
const { ruleForTeam } = require('./x-build-rules');

const DATA_PATH = path.join(__dirname, '..', 'data', 'matches.json');
const COUNTS_URL = 'https://api.x.com/2/tweets/counts/recent';

/** FIFA codes playing in today's matches (falls back to the last match day). */
function activeTeamCodes() {
  try {
    const m = JSON.parse(fs.readFileSync(DATA_PATH, 'utf8'));
    const todayShort = new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    let dayIdx = (m.days || []).findIndex((d) => d.short === todayShort);
    if (dayIdx < 0) dayIdx = (m.days || []).length - 1;
    const set = new Set();
    for (const x of (m.dayMatches && m.dayMatches[dayIdx]) || []) {
      if (x.a) set.add(x.a);
      if (x.b) set.add(x.b);
    }
    return [...set];
  } catch {
    return [];
  }
}

const utcDay = () => new Date().toISOString().slice(0, 10);

/**
 * Build the counts poller. `engine` is the buzz engine (uses setSignals()).
 * Returns { start(signal), stats() } — stats() is read by /api/x/health.
 */
function createCountsPoller({ engine, log = console } = {}) {
  const INTERVAL = Number(process.env.X_COUNTS_INTERVAL_MS) || 300_000;
  const WINDOW_MIN = Number(process.env.X_COUNTS_WINDOW_MIN) || 10;
  const DAILY_CAP = Number(process.env.X_COUNTS_DAILY_CAP) || 2000;

  const stats = {
    mode: 'counts',
    enabled: false,
    tokenConfigured: !!process.env.X_BEARER_TOKEN,
    activeTeams: [],
    lastPollMs: null,
    requestsToday: 0,
    dailyCap: DAILY_CAP,
    capped: false,
    intervalMs: INTERVAL,
    windowMin: WINDOW_MIN,
    rateRemaining: null,
    rateCap: null,
    rateResetMs: null,
    errors: 0,
    lastEvent: 'idle',
  };
  let day = utcDay();

  function captureRate(r) {
    const rem = r.headers.get('x-rate-limit-remaining');
    const lim = r.headers.get('x-rate-limit-limit');
    const reset = r.headers.get('x-rate-limit-reset');
    if (rem != null) stats.rateRemaining = Number(rem);
    if (lim != null) stats.rateCap = Number(lim);
    if (reset != null) stats.rateResetMs = Number(reset) * 1000;
  }

  async function countFor(code) {
    const rule = ruleForTeam(code);
    if (!rule) return 0;
    const start = new Date(Date.now() - WINDOW_MIN * 60_000).toISOString();
    const url = `${COUNTS_URL}?query=${encodeURIComponent(rule.value)}&granularity=minute&start_time=${start}`;
    const r = await fetch(url, { headers: { Authorization: `Bearer ${process.env.X_BEARER_TOKEN}` } });
    captureRate(r);
    if (!r.ok) {
      stats.errors++;
      stats.lastEvent = `counts HTTP ${r.status}`;
      return 0;
    }
    const body = await r.json().catch(() => ({}));
    return (body && body.meta && body.meta.total_tweet_count) || 0;
  }

  async function cycle() {
    if (utcDay() !== day) { day = utcDay(); stats.requestsToday = 0; stats.capped = false; }

    const codes = activeTeamCodes();
    stats.activeTeams = codes;
    if (!codes.length) {
      engine.setSignals({});
      stats.lastEvent = 'no matches today — idle (no requests)';
      return;
    }

    // Circuit breaker: don't start a cycle we can't finish within the cap.
    if (stats.requestsToday + codes.length > DAILY_CAP) {
      stats.capped = true;
      stats.lastEvent = `daily cap ${DAILY_CAP} reached — paused until UTC reset`;
      engine.setSignals({}); // fade back to the free simulation
      return;
    }
    stats.capped = false;

    const counts = {};
    for (const code of codes) {
      counts[code] = await countFor(code);
      stats.requestsToday++;
    }

    // Normalize to 0..1 (sqrt compresses the heavy tail so mid-volume nations
    // still register); the engine raises each nation's glow floor to this.
    const max = Math.max(1, ...Object.values(counts));
    const signals = {};
    for (const code of codes) signals[code] = counts[code] > 0 ? Math.sqrt(counts[code] / max) : 0;
    engine.setSignals(signals);

    // Per-team transparency for the UI: the exact query we send to X and the
    // post-count volume it returned (no post bodies — counts endpoint only).
    const perTeam = {};
    for (const code of codes) {
      const rule = ruleForTeam(code);
      perTeam[code] = { query: rule ? rule.value : '', count: counts[code], signal: Math.round((signals[code] || 0) * 100) / 100 };
    }
    stats.perTeam = perTeam;

    stats.lastPollMs = Date.now();
    const top = codes.reduce((a, b) => (counts[b] >= counts[a] ? b : a), codes[0]);
    stats.lastEvent = `polled ${codes.length} team(s) · hottest ${top} (${counts[top]})`;
  }

  function start(signal) {
    if (!process.env.X_BEARER_TOKEN) {
      log.warn('[buzz-counts] X_BEARER_TOKEN not set — counts mode disabled');
      return;
    }
    stats.enabled = true;
    stats.lastEvent = 'starting…';
    const run = () =>
      cycle().catch((e) => {
        stats.errors++;
        stats.lastEvent = 'cycle error: ' + e.message;
        log.error('[buzz-counts]', e.message);
      });
    run();
    const id = setInterval(() => {
      if (signal && signal.aborted) { clearInterval(id); return; }
      run();
    }, INTERVAL);
    if (id.unref) id.unref();
    if (signal && signal.addEventListener) {
      signal.addEventListener('abort', () => { clearInterval(id); engine.setSignals({}); stats.enabled = false; });
    }
  }

  return { start, stats: () => ({ ...stats }), cycle, activeTeamCodes };
}

module.exports = { createCountsPoller, activeTeamCodes };
