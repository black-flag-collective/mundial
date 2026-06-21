'use strict';

/**
 * Cost-effective real-time buzz via the X v2 **counts** endpoint.
 *
 * Instead of the filtered-stream firehose (billed per post pulled — the ~$5/min
 * problem), this asks X only *how many* posts match per team and feeds that
 * volume into the buzz engine as a sustained per-country signal. No post bodies
 * are retrieved, so cost is bounded by request count, not match volume.
 *
 * The buzz layer is meant to be the World Cup's heartbeat — something you keep
 * open during a match to watch your country light up. To make that feel live
 * without an always-on bill, polling is driven by the actual match clock
 * (every fixture carries an absolute `ko` kickoff timestamp in data/matches.json):
 *
 *   1. **Live-window scoped.** We poll only teams whose match is in its live
 *      window (kickoff → +MATCH_MIN) or a short post-match cooldown. When no
 *      match is live, we make **zero** X requests — match state is read from
 *      disk for free, so an idle tournament day costs nothing.
 *   2. **Adaptive cadence.** Fast (LIVE_INTERVAL, ~90s) while a match is live so
 *      the globe pulses in near-real-time; a slow, request-free re-check
 *      (IDLE_INTERVAL, ~10m) the rest of the time just to notice the next kickoff.
 *   3. **Momentum, for free.** The counts response is per-minute, so we derive a
 *      rising/falling trend and goal-reaction surges from data we already pulled
 *      — no extra requests. Sustained volume sets a country's glow floor; a
 *      sudden minute-over-minute jump fires a spike (the goal-reaction pop).
 *   4. **Hard daily cap.** A request budget with a circuit breaker that pauses
 *      polling (buzz fades back to the free simulation) when hit.
 *
 * Off unless `X_BUZZ_MODE=counts` and `X_BEARER_TOKEN` are set. Tunables:
 *   X_COUNTS_LIVE_INTERVAL_MS (default 90000=90s while a match is live)
 *   X_COUNTS_IDLE_INTERVAL_MS (default 600000=10m request-free re-check)
 *   X_COUNTS_WINDOW_MIN       (default 10  recent-volume window per poll)
 *   X_COUNTS_MATCH_MIN        (default 150 live-window length after kickoff)
 *   X_COUNTS_WARMUP_MIN       (default 0   pre-kickoff hype window; off by default)
 *   X_COUNTS_COOLDOWN_MIN     (default 30  post-match reaction window)
 *   X_COUNTS_DAILY_CAP        (default 2000 requests/UTC-day)
 *
 * Docs: https://docs.x.com/x-api/x-posts/recent-search-counts
 */

const fs = require('fs');
const path = require('path');
const { ruleForTeam } = require('./x-build-rules');

const DATA_PATH = path.join(__dirname, '..', 'data', 'matches.json');
const COUNTS_URL = 'https://api.x.com/2/tweets/counts/recent';

function parseMatches() {
  try {
    return JSON.parse(fs.readFileSync(DATA_PATH, 'utf8'));
  } catch {
    return null;
  }
}

/** FIFA codes playing in today's matches (falls back to the last match day).
 *  Kept for callers/tests that want the day's roster regardless of live state. */
function activeTeamCodes() {
  const m = parseMatches();
  if (!m) return [];
  const todayShort = new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  let dayIdx = (m.days || []).findIndex((d) => d.short === todayShort);
  if (dayIdx < 0) dayIdx = (m.days || []).length - 1;
  const set = new Set();
  for (const x of (m.dayMatches && m.dayMatches[dayIdx]) || []) {
    if (x.a) set.add(x.a);
    if (x.b) set.add(x.b);
  }
  return [...set];
}

/**
 * Which teams are "hot" right now, derived from each fixture's absolute `ko`
 * kickoff timestamp (authoritative — it doesn't lag like the periodically
 * refreshed `st` field). A match contributes its two teams when now is within:
 *   - [ko − warmupMs, ko)            → 'warmup'  (off by default)
 *   - [ko, ko + matchMs]             → 'live'
 *   - (ko + matchMs, +cooldownMs]    → 'cooldown'
 * Overall phase is the hottest contribution (live > warmup/cooldown > idle).
 * Returns { codes, phase } — codes empty + phase 'idle' means: poll nothing.
 */
function liveContext(opts = {}) {
  const now = opts.now != null ? opts.now : Date.now();
  const matchMs = (opts.matchMin != null ? opts.matchMin : 150) * 60_000;
  const warmupMs = (opts.warmupMin != null ? opts.warmupMin : 0) * 60_000;
  const cooldownMs = (opts.cooldownMin != null ? opts.cooldownMin : 30) * 60_000;

  const m = opts.matches || parseMatches();
  const codes = new Set();
  let phase = 'idle';
  const rank = { live: 3, warmup: 2, cooldown: 2, idle: 0 };

  if (m && Array.isArray(m.dayMatches)) {
    for (const day of m.dayMatches) {
      for (const x of day || []) {
        const ko = x && x.ko ? Date.parse(x.ko) : NaN;
        if (Number.isNaN(ko)) continue;
        let p = null;
        if (now >= ko && now <= ko + matchMs) p = 'live';
        else if (warmupMs > 0 && now >= ko - warmupMs && now < ko) p = 'warmup';
        else if (now > ko + matchMs && now <= ko + matchMs + cooldownMs) p = 'cooldown';
        if (!p) continue;
        if (x.a) codes.add(x.a);
        if (x.b) codes.add(x.b);
        if (rank[p] > rank[phase]) phase = p;
      }
    }
  }
  return { codes: [...codes], phase };
}

/**
 * Momentum from the per-minute counts series (no extra request — it ships with
 * every counts call). Compares the latest minute against the trailing baseline:
 *   trend > 0  rising (a country heating up — goal, big chance, controversy)
 *   trend ~ 0  steady
 *   trend < 0  cooling off
 * Returns { recent, baseline, trend } with trend clamped to [-1, 1].
 */
function computeTrend(series) {
  if (!Array.isArray(series) || series.length < 2) return { recent: 0, baseline: 0, trend: 0 };
  const counts = series.map((b) => (b && b.tweet_count) | 0);
  const recent = counts[counts.length - 1];
  const prior = counts.slice(0, -1);
  const baseline = prior.reduce((a, b) => a + b, 0) / prior.length;
  // Symmetric ratio so a doubling reads ~+0.5 and a halving ~−0.5; +1 smooths
  // out the divide-by-tiny-baseline case for low-volume nations.
  const trend = Math.max(-1, Math.min(1, (recent - baseline) / (recent + baseline + 1)));
  return { recent, baseline, trend };
}

const utcDay = () => new Date().toISOString().slice(0, 10);

/**
 * Build the counts poller. `engine` is the buzz engine (uses setSignals() for
 * the sustained floor and surge() for momentum pops). `context` resolves the
 * hot-team set (defaults to the live-window logic; injectable for tests).
 * Returns { start(signal), stats(), cycle(), ... } — stats() feeds /api/x/health.
 */
function createCountsPoller({ engine, log = console, context } = {}) {
  const LIVE_INTERVAL =
    Number(process.env.X_COUNTS_LIVE_INTERVAL_MS) ||
    Number(process.env.X_COUNTS_INTERVAL_MS) || // back-compat with the old fixed knob
    90_000;
  const IDLE_INTERVAL = Number(process.env.X_COUNTS_IDLE_INTERVAL_MS) || 600_000;
  const WINDOW_MIN = Number(process.env.X_COUNTS_WINDOW_MIN) || 10;
  const DAILY_CAP = Number(process.env.X_COUNTS_DAILY_CAP) || 2000;
  const MATCH_MIN = Number(process.env.X_COUNTS_MATCH_MIN) || 150;
  const WARMUP_MIN = Number(process.env.X_COUNTS_WARMUP_MIN) || 0;
  const COOLDOWN_MIN = Number(process.env.X_COUNTS_COOLDOWN_MIN) || 30;
  const SURGE_MULT = Number(process.env.X_COUNTS_SURGE_MULT) || 0.6;

  const resolveContext =
    context || (() => liveContext({ matchMin: MATCH_MIN, warmupMin: WARMUP_MIN, cooldownMin: COOLDOWN_MIN }));

  const stats = {
    mode: 'counts',
    enabled: false,
    tokenConfigured: !!process.env.X_BEARER_TOKEN,
    phase: 'idle',
    activeTeams: [],
    lastPollMs: null,
    nextPollMs: null,
    requestsToday: 0,
    dailyCap: DAILY_CAP,
    capped: false,
    liveIntervalMs: LIVE_INTERVAL,
    idleIntervalMs: IDLE_INTERVAL,
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

  /** One counts request for a team → { total, series } (volume only, no bodies). */
  async function countFor(code) {
    const rule = ruleForTeam(code);
    if (!rule) return { total: 0, series: [] };
    const start = new Date(Date.now() - WINDOW_MIN * 60_000).toISOString();
    const url = `${COUNTS_URL}?query=${encodeURIComponent(rule.value)}&granularity=minute&start_time=${start}`;
    const r = await fetch(url, { headers: { Authorization: `Bearer ${process.env.X_BEARER_TOKEN}` } });
    captureRate(r);
    if (!r.ok) {
      stats.errors++;
      stats.lastEvent = `counts HTTP ${r.status}`;
      return { total: 0, series: [] };
    }
    const body = await r.json().catch(() => ({}));
    const total = (body && body.meta && body.meta.total_tweet_count) || 0;
    const series = (body && Array.isArray(body.data)) ? body.data : [];
    return { total, series };
  }

  async function cycle(ctx) {
    if (utcDay() !== day) { day = utcDay(); stats.requestsToday = 0; stats.capped = false; }

    const context = ctx || resolveContext();
    const codes = context.codes || [];
    stats.phase = context.phase || 'idle';
    stats.activeTeams = codes;

    if (!codes.length) {
      engine.setSignals({});
      stats.lastEvent = 'no live match — idle (no requests)';
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
    const trends = {};
    for (const code of codes) {
      const { total, series } = await countFor(code);
      counts[code] = total;
      trends[code] = computeTrend(series).trend;
      stats.requestsToday++;
      // A sharp minute-over-minute jump = a goal-reaction pop: flare the spike
      // so the globe visibly reacts in near-real-time (decays in the engine).
      if (trends[code] > 0.25 && engine.surge) engine.surge(code, trends[code] * SURGE_MULT);
    }

    // Normalize sustained volume to 0..1 (sqrt compresses the heavy tail so
    // mid-volume nations still register); the engine raises each glow floor to it.
    const max = Math.max(1, ...Object.values(counts));
    const signals = {};
    for (const code of codes) signals[code] = counts[code] > 0 ? Math.sqrt(counts[code] / max) : 0;
    engine.setSignals(signals);

    // Per-team transparency for the UI: the exact query we send to X, the
    // post-count volume, the normalized signal, and the rising/falling trend.
    const perTeam = {};
    for (const code of codes) {
      const rule = ruleForTeam(code);
      perTeam[code] = {
        query: rule ? rule.value : '',
        count: counts[code],
        signal: Math.round((signals[code] || 0) * 100) / 100,
        trend: Math.round((trends[code] || 0) * 100) / 100,
      };
    }
    stats.perTeam = perTeam;

    stats.lastPollMs = Date.now();
    const top = codes.reduce((a, b) => (counts[b] >= counts[a] ? b : a), codes[0]);
    stats.lastEvent = `${stats.phase} · polled ${codes.length} team(s) · hottest ${top} (${counts[top]})`;
  }

  function start(signal) {
    if (!process.env.X_BEARER_TOKEN) {
      log.warn('[buzz-counts] X_BEARER_TOKEN not set — counts mode disabled');
      return;
    }
    stats.enabled = true;
    stats.lastEvent = 'starting…';

    const tick = async () => {
      if (signal && signal.aborted) return;
      let nextDelay = IDLE_INTERVAL;
      try {
        const context = resolveContext();
        if ((context.codes || []).length) {
          await cycle(context);
          // Any active window (live/warmup/cooldown) polls on the fast cadence;
          // a quiet tournament hour falls back to the request-free idle re-check.
          nextDelay = context.phase === 'idle' ? IDLE_INTERVAL : LIVE_INTERVAL;
        } else {
          // No live match: spend nothing, just re-check for the next kickoff.
          engine.setSignals({});
          stats.phase = 'idle';
          stats.activeTeams = [];
          stats.lastEvent = 'no live match — idle (no requests)';
        }
      } catch (e) {
        stats.errors++;
        stats.lastEvent = 'cycle error: ' + e.message;
        log.error('[buzz-counts]', e.message);
      }
      if (signal && signal.aborted) return;
      stats.nextPollMs = Date.now() + nextDelay;
      timer = setTimeout(tick, nextDelay);
      if (timer.unref) timer.unref();
    };

    let timer = null;
    if (signal && signal.addEventListener) {
      signal.addEventListener('abort', () => {
        if (timer) clearTimeout(timer);
        engine.setSignals({});
        stats.enabled = false;
        stats.nextPollMs = null;
      });
    }
    tick();
  }

  return { start, stats: () => ({ ...stats }), cycle, activeTeamCodes, liveContext: resolveContext };
}

module.exports = { createCountsPoller, activeTeamCodes, liveContext, computeTrend };
