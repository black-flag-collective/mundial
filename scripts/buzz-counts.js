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
 *   2. **Activity-adaptive cadence.** While a match is live the poll interval
 *      flexes between a fast floor (LIVE_INTERVAL, ~60s) and a calm ceiling
 *      (LIVE_CALM_INTERVAL, ~150s) by how lively the match is: a flat 0–0 drifts
 *      calm to save requests, a rising surge snaps back to fast, and knockout
 *      fixtures always poll fast. The rest of the time a request-free re-check
 *      (IDLE_INTERVAL, ~10m) just notices the next kickoff.
 *   3. **Momentum, for free.** The counts response is per-minute, so we derive a
 *      rising/falling trend and goal-reaction surges from data we already pulled
 *      — no extra requests. Sustained volume sets a country's glow floor; a
 *      sudden minute-over-minute jump fires a spike (the goal-reaction pop).
 *   4. **Tournament-wide pulse.** One extra request on the slow tier (only while
 *      a match is live) for overall World-Cup chatter — a global heartbeat and an
 *      absolute scale, so a quiet day glows dimmer than a final.
 *   5. **Hard daily cap.** A request budget with a circuit breaker that pauses
 *      polling (buzz fades to idle/zeros — no simulated signal) when hit.
 *
 * Off unless `X_BUZZ_MODE=counts` and `X_BEARER_TOKEN` are set. Tunables:
 *   X_COUNTS_LIVE_INTERVAL_MS      (default 60000=60s fast floor while live)
 *   X_COUNTS_LIVE_CALM_INTERVAL_MS (default 150000=150s calm ceiling for a flat match)
 *   X_COUNTS_SLOW_INTERVAL_MS      (default 300000=5m warmup/cooldown + pulse cadence)
 *   X_COUNTS_IDLE_INTERVAL_MS      (default 600000=10m request-free re-check)
 *   X_COUNTS_WINDOW_MIN            (default 10  recent-volume window per poll)
 *   X_COUNTS_MATCH_MIN            (default 150 live-window length after kickoff)
 *   X_COUNTS_WARMUP_MIN          (default 0   pre-kickoff hype window; off by default)
 *   X_COUNTS_COOLDOWN_MIN       (default 30  post-match reaction window)
 *   X_COUNTS_PULSE_DISABLED    (set 1 to turn off the tournament-wide pulse)
 *   X_COUNTS_DAILY_CAP        (default 2000 requests/UTC-day)
 *
 * Docs: https://docs.x.com/x-api/x-posts/recent-search-counts
 */

const fs = require('fs');
const path = require('path');
const { ruleForTeam, CONTEXT } = require('./x-build-rules');

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
 * Returns { codes, phase, phases, koLive } where `phases[code]` is that nation's
 * hottest window right now — used to poll live matches faster than warmup/cooldown
 * ones — and `koLive` is true when any *live* match is a knockout fixture (its
 * group label isn't one of the 12 group letters A–L), so the cadence can keep
 * the high-stakes games on the fast tier. codes empty + phase 'idle' means: poll
 * nothing.
 */
function isKnockout(g) {
  return g != null && g !== '' && !/^[A-L]$/i.test(String(g).trim());
}

function liveContext(opts = {}) {
  const now = opts.now != null ? opts.now : Date.now();
  const matchMs = (opts.matchMin != null ? opts.matchMin : 150) * 60_000;
  const warmupMs = (opts.warmupMin != null ? opts.warmupMin : 0) * 60_000;
  const cooldownMs = (opts.cooldownMin != null ? opts.cooldownMin : 30) * 60_000;

  const m = opts.matches || parseMatches();
  const phases = {};
  let phase = 'idle';
  let koLive = false;
  const rank = { live: 3, warmup: 2, cooldown: 1, idle: 0 };
  const bump = (code, p) => { if (code && (!phases[code] || rank[p] > rank[phases[code]])) phases[code] = p; };

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
        bump(x.a, p);
        bump(x.b, p);
        if (p === 'live' && isKnockout(x.g)) koLive = true;
        if (rank[p] > rank[phase]) phase = p;
      }
    }
  }
  return { codes: Object.keys(phases), phase, phases, koLive };
}

/**
 * Is a nation due for a counts request this cycle? Live matches refresh every
 * cycle (the heartbeat); warmup/cooldown nations refresh only once per slow
 * interval, so we spend the budget where the action is.
 */
function dueForFetch(phase, lastFetchAt, now, slowMs) {
  if (phase === 'live') return true;
  return now - (lastFetchAt || 0) >= slowMs;
}

/**
 * Adaptive cadence for a live window: interpolate between the fast floor
 * (`fastMs`) and the calm ceiling (`calmMs`) by how lively the match is
 * (`activity`, 0..1). A flat 0–0 (activity≈0) drifts toward calm; a rising
 * surge (activity≈1) snaps to the fast floor. Knockout matches always poll fast.
 */
function liveDelay(activity, koLive, fastMs, calmMs) {
  if (koLive) return fastMs;
  const a = Math.max(0, Math.min(1, activity || 0));
  return Math.round(calmMs - a * (calmMs - fastMs));
}

/**
 * Absolute board scale from the tournament-wide pulse: how bright the whole
 * globe should glow relative to its busiest moment. `total` is the current
 * tournament-wide volume, `peak` the rolling busiest seen. Returns 1 (no change)
 * until a pulse has run (peak 0 / total null), otherwise sqrt(total/peak) floored
 * so a live match is never fully dark and clamped to ≤1 so it can never inflate a
 * signal past full (defensive — the caller maxes `peak` before calling).
 */
function absoluteScale(total, peak, floor = 0.35) {
  if (!(peak > 0) || total == null) return 1;
  return Math.min(1, Math.max(floor, Math.sqrt(total / peak)));
}

/**
 * Update the rolling tournament-wide peak: a fresh high wins immediately,
 * otherwise the previous peak bleeds down by `decay` so a past blockbuster
 * doesn't permanently dim the board on a long-running process.
 */
function decayPeak(prevPeak, total, decay = 0.98) {
  return Math.max(Number(total) || 0, (Number(prevPeak) || 0) * decay);
}

/**
 * Everything we can squeeze out of the per-minute counts series — all of it
 * ships with the same counts request, so these add zero extra cost:
 *   - trend:   latest minute vs the trailing baseline (−1..1; rising/falling)
 *   - peak:    busiest single minute in the window (posts/min)
 *   - current: the latest minute's rate (posts/min)
 *   - minutes: the raw per-minute counts (for a UI sparkline)
 */
function computeTrend(series) {
  const counts = Array.isArray(series) ? series.map((b) => (b && b.tweet_count) | 0) : [];
  if (!counts.length) return { recent: 0, baseline: 0, trend: 0, peak: 0, current: 0, minutes: [] };
  const recent = counts[counts.length - 1];
  const peak = Math.max(...counts);
  if (counts.length < 2) return { recent, baseline: 0, trend: 0, peak, current: recent, minutes: counts };
  const prior = counts.slice(0, -1);
  const baseline = prior.reduce((a, b) => a + b, 0) / prior.length;
  // Symmetric ratio so a doubling reads ~+0.5 and a halving ~−0.5; +1 smooths
  // out the divide-by-tiny-baseline case for low-volume nations.
  const trend = Math.max(-1, Math.min(1, (recent - baseline) / (recent + baseline + 1)));
  return { recent, baseline, trend, peak, current: recent, minutes: counts };
}

const utcDay = () => new Date().toISOString().slice(0, 10);

/**
 * Resolve the active buzz source from the environment. Cost-safe by default:
 * the cost-bounded counts poller unless the operator explicitly opts into the
 * billed-per-post firehose with X_BUZZ_MODE=stream. (Whether either actually
 * polls still depends on X_BEARER_TOKEN being set.)
 */
function resolveBuzzMode(env = process.env) {
  return env.X_BUZZ_MODE === 'stream' ? 'stream' : 'counts';
}

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
    60_000;
  // Calm end of the live band: a quiet, scoreless live match drifts out to this
  // cadence, snapping back to LIVE_INTERVAL the moment buzz rises (a goal, a
  // surge) — so the request budget is spent on the exciting minutes. Clamped to
  // be no faster than LIVE_INTERVAL.
  const LIVE_CALM_INTERVAL = Math.max(LIVE_INTERVAL, Number(process.env.X_COUNTS_LIVE_CALM_INTERVAL_MS) || 150_000);
  // Warmup/cooldown nations refresh on this slower tier (live polls every cycle).
  const SLOW_INTERVAL = Number(process.env.X_COUNTS_SLOW_INTERVAL_MS) || 300_000;
  const IDLE_INTERVAL = Number(process.env.X_COUNTS_IDLE_INTERVAL_MS) || 600_000;
  const WINDOW_MIN = Number(process.env.X_COUNTS_WINDOW_MIN) || 10;
  const DAILY_CAP = Number(process.env.X_COUNTS_DAILY_CAP) || 2000;
  const MATCH_MIN = Number(process.env.X_COUNTS_MATCH_MIN) || 150;
  const WARMUP_MIN = Number(process.env.X_COUNTS_WARMUP_MIN) || 0;
  const COOLDOWN_MIN = Number(process.env.X_COUNTS_COOLDOWN_MIN) || 30;
  const SURGE_MULT = Number(process.env.X_COUNTS_SURGE_MULT) || 0.6;
  // Tournament-wide pulse: one extra counts request for overall World-Cup chatter,
  // polled on the slow tier *only while a match is live* (never when idle, so a
  // quiet day still costs $0). Gives a global heartbeat and an absolute scale so a
  // dull day glows dimmer than a final. Off with X_COUNTS_PULSE_DISABLED=1.
  const PULSE_ENABLED = process.env.X_COUNTS_PULSE_DISABLED !== '1';
  const PULSE_QUERY = `${CONTEXT} -is:retweet`;
  // The tournament-wide peak decays a little each pulse so it tracks *recent*
  // volume (≈ the last match) instead of ratcheting to an all-time max that would
  // permanently dim the board on a long-running process. A new high still wins
  // immediately. ~0.98/pulse ≈ a half-life of one match's worth of live polling.
  // Respect an explicit 0 (disable cross-match dimming: peak always tracks the
  // current pulse). `Number(env) || 0.98` would silently turn 0 into 0.98.
  const PEAK_DECAY = (() => {
    const v = Number(process.env.X_COUNTS_PULSE_PEAK_DECAY);
    return Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 0.98;
  })();

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
    rateLimited: false,
    pausedUntilMs: null,
    liveIntervalMs: LIVE_INTERVAL,
    liveCalmIntervalMs: LIVE_CALM_INTERVAL,
    slowIntervalMs: SLOW_INTERVAL,
    idleIntervalMs: IDLE_INTERVAL,
    windowMin: WINDOW_MIN,
    liveActivity: 0,        // 0..1 — how lively the live matches are right now
    nextDelayMs: null,      // the adaptive delay chosen for the next cycle
    tournamentTotal: null,  // overall World-Cup post volume (tournament-wide pulse)
    tournamentTrend: null,  // its minute-over-minute trend (−1..1)
    rateRemaining: null,
    rateCap: null,
    rateResetMs: null,
    errors: 0,
    lastEvent: 'idle',
  };
  let day = utcDay();
  // Per-code state persists across cycles so a cooldown nation polled on the slow
  // tier keeps its last signal between refreshes (instead of dropping to zero).
  const lastFetchAt = {}; // code -> ms of last successful counts request
  const lastCount = {};   // code -> last total
  const perTeamState = {}; // code -> { query, count, signal, trend }
  let pausedUntil = 0;    // ms epoch — when X rate-limited us, don't spend until this
  let lastPulseAt = 0;    // ms epoch of the last tournament-wide pulse request
  let tournamentPeak = 0; // recent busiest tournament-wide volume (decays per pulse), for absolute scaling

  function captureRate(r) {
    const rem = r.headers.get('x-rate-limit-remaining');
    const lim = r.headers.get('x-rate-limit-limit');
    const reset = r.headers.get('x-rate-limit-reset');
    if (rem != null) stats.rateRemaining = Number(rem);
    if (lim != null) stats.rateCap = Number(lim);
    if (reset != null) stats.rateResetMs = Number(reset) * 1000;
  }

  /** One counts request for an arbitrary query → { total, series } (volume only,
   *  no bodies). Shared by the per-team poll and the tournament-wide pulse. */
  async function countForQuery(query) {
    const start = new Date(Date.now() - WINDOW_MIN * 60_000).toISOString();
    const url = `${COUNTS_URL}?query=${encodeURIComponent(query)}&granularity=minute&start_time=${start}`;
    const r = await fetch(url, { headers: { Authorization: `Bearer ${process.env.X_BEARER_TOKEN}` } });
    captureRate(r);
    if (!r.ok) {
      stats.errors++;
      stats.lastEvent = `counts HTTP ${r.status}`;
      // Rate-limited (429) or capacity (420): honor the server's reset window so
      // we stop spending requests that only earn more 429s. Falls back to ~60s.
      if (r.status === 429 || r.status === 420) {
        const reset = r.headers.get('x-rate-limit-reset');
        const retry = r.headers.get('retry-after');
        const resetMs = reset ? Number(reset) * 1000 : (retry ? Date.now() + Number(retry) * 1000 : Date.now() + 60_000);
        return { total: 0, series: [], rateLimited: true, resetMs };
      }
      return { total: 0, series: [] };
    }
    const body = await r.json().catch(() => ({}));
    const total = (body && body.meta && body.meta.total_tweet_count) || 0;
    const series = (body && Array.isArray(body.data)) ? body.data : [];
    return { total, series };
  }

  /** One counts request for a team → { total, series } (volume only, no bodies). */
  async function countFor(code) {
    const rule = ruleForTeam(code);
    if (!rule) return { total: 0, series: [] };
    return countForQuery(rule.value);
  }

  async function cycle(ctx) {
    if (utcDay() !== day) { day = utcDay(); stats.requestsToday = 0; stats.capped = false; }

    const context = ctx || resolveContext();
    const codes = context.codes || [];
    const phases = context.phases || {};
    const phaseOf = (code) => phases[code] || 'live'; // default 'live' if unspecified
    stats.phase = context.phase || 'idle';
    stats.activeTeams = codes;

    // Drop state for nations no longer in any window so they fade to idle (zeros).
    const hot = new Set(codes);
    for (const c of Object.keys(lastCount)) if (!hot.has(c)) { delete lastCount[c]; delete lastFetchAt[c]; delete perTeamState[c]; }

    if (!codes.length) {
      engine.setSignals({});
      stats.liveActivity = 0;
      // The tournament-wide heartbeat is a live-only signal — clear it so the API
      // doesn't report a stale pulse between matches, and reset lastPulseAt so the
      // next live window always opens with a fresh pulse (not gated by SLOW_INTERVAL
      // since the previous match). The decaying tournamentPeak is intentionally
      // kept, so a new match is still scaled against recent tournament activity.
      stats.tournamentTotal = null;
      stats.tournamentTrend = null;
      lastPulseAt = 0;
      stats.lastEvent = 'no live match — idle (no requests)';
      return;
    }

    // Tiered selection: live nations every cycle, warmup/cooldown on the slow tier.
    const now = Date.now();
    // Respect a rate-limit pause: while X has us paused we spend nothing, but the
    // board stays alive from last-known counts (normalized below). Skip the fetch.
    const paused = now < pausedUntil;
    const fetchCodes = paused ? [] : codes.filter((c) => dueForFetch(phaseOf(c), lastFetchAt[c], now, SLOW_INTERVAL));

    // Circuit breaker: don't start a fetch we can't finish within the daily cap.
    if (fetchCodes.length && stats.requestsToday + fetchCodes.length > DAILY_CAP) {
      stats.capped = true;
      stats.lastEvent = `daily cap ${DAILY_CAP} reached — paused until UTC reset`;
      engine.setSignals({}); // fade to idle (zeros) — no simulated signal
      return;
    }
    stats.capped = false;

    let fetched = 0;
    for (const code of fetchCodes) {
      const { total, series, rateLimited, resetMs } = await countFor(code);
      if (rateLimited) {
        // X rate-limited us — back off until its reset window, don't keep trying.
        pausedUntil = resetMs || (Date.now() + 60_000);
        stats.lastEvent = `rate-limited by X — pausing counts until ${new Date(pausedUntil).toLocaleTimeString()}`;
        break;
      }
      const s = computeTrend(series);
      lastCount[code] = total;
      lastFetchAt[code] = Date.now();
      stats.requestsToday++;
      fetched++;
      const rule = ruleForTeam(code);
      perTeamState[code] = {
        query: rule ? rule.value : '',
        count: total,
        trend: Math.round(s.trend * 100) / 100,
        peak: s.peak,            // busiest minute (posts/min) — free, from the series
        current: s.current,      // latest minute's rate (posts/min)
        minutes: s.minutes,      // per-minute counts, for a UI sparkline
        signal: 0,               // filled in after normalization below
      };
      // A sharp minute-over-minute jump = a goal-reaction pop: flare the spike
      // so the globe visibly reacts in near-real-time (decays in the engine).
      if (s.trend > 0.25 && engine.surge) engine.surge(code, s.trend * SURGE_MULT);
    }

    // Live-match activity (0..1): the strongest rising trend among nations whose
    // match is live. Drives the adaptive cadence — a flat 0–0 lets the next poll
    // drift toward the calm interval; a surge snaps it back to the fast floor.
    const liveCodes = codes.filter((c) => phaseOf(c) === 'live');
    let activity = 0;
    for (const c of liveCodes) {
      const tr = perTeamState[c] ? perTeamState[c].trend : 0;
      if (tr > activity) activity = tr;
    }
    stats.liveActivity = Math.max(0, Math.min(1, activity));

    // Tournament-wide pulse: one extra request for overall World-Cup chatter, on
    // the slow tier and only while a match is live. Gives a global heartbeat and
    // an absolute scale so a quiet day glows dimmer than a final.
    // Re-check the pause state: a 429 inside the team loop above sets pausedUntil,
    // and we must not spend the pulse request right after backing off.
    const anyLive = liveCodes.length > 0;
    const pulseDue = PULSE_ENABLED && Date.now() >= pausedUntil && anyLive && (now - lastPulseAt >= SLOW_INTERVAL);
    if (pulseDue && stats.requestsToday + 1 <= DAILY_CAP) {
      const { total, series, rateLimited, resetMs } = await countForQuery(PULSE_QUERY);
      if (rateLimited) {
        pausedUntil = resetMs || (Date.now() + 60_000);
        stats.lastEvent = `rate-limited by X — pausing counts until ${new Date(pausedUntil).toLocaleTimeString()}`;
      } else {
        const ts = computeTrend(series);
        stats.requestsToday++;
        lastPulseAt = Date.now();
        stats.tournamentTotal = total;
        stats.tournamentTrend = Math.round(ts.trend * 100) / 100;
        // Track the recent peak: a new high wins immediately, otherwise the old
        // peak bleeds down so a past blockbuster doesn't dim the board forever.
        tournamentPeak = decayPeak(tournamentPeak, total, PEAK_DECAY);
      }
    }

    // Normalize sustained volume across the full hot set (using each nation's
    // last known count, so slow-tier nations keep their glow between refreshes).
    const max = Math.max(1, ...codes.map((c) => lastCount[c] || 0));
    // Absolute scale from the tournament-wide pulse: dim the whole board on a
    // quiet day, let it glow full during the busiest periods. 1 (no change) until
    // the pulse has run; floored so a live match is never fully dark.
    const dayScale = absoluteScale(stats.tournamentTotal, tournamentPeak);
    const signals = {};
    for (const code of codes) {
      const cnt = lastCount[code] || 0;
      const sig = cnt > 0 ? Math.sqrt(cnt / max) * dayScale : 0;
      signals[code] = sig;
      if (perTeamState[code]) perTeamState[code].signal = Math.round(sig * 100) / 100;
    }
    engine.setSignals(signals);

    // Surface only the currently-hot nations (pruned set above).
    const perTeam = {};
    for (const code of codes) if (perTeamState[code]) perTeam[code] = perTeamState[code];
    stats.perTeam = perTeam;

    stats.rateLimited = Date.now() < pausedUntil;
    stats.pausedUntilMs = pausedUntil || null;

    if (fetched) {
      stats.lastPollMs = Date.now();
      const top = codes.reduce((a, b) => ((lastCount[b] || 0) >= (lastCount[a] || 0) ? b : a), codes[0]);
      stats.lastEvent = `${stats.phase} · fetched ${fetched}/${codes.length} team(s) · hottest ${top} (${lastCount[top] || 0})`;
    }
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
      // Resolve liveness up front so the cadence is known even if cycle() throws:
      // a transient fetch error during a live match must keep retrying on the live
      // tier, not silently drop to the 10-minute idle re-check.
      const context = resolveContext();
      const codes = context.codes || [];
      const phases = context.phases || {};
      const anyLive = codes.some((c) => (phases[c] || 'live') === 'live');
      const pickDelay = () => (!codes.length
        ? IDLE_INTERVAL
        : (anyLive ? liveDelay(stats.liveActivity, context.koLive, LIVE_INTERVAL, LIVE_CALM_INTERVAL) : SLOW_INTERVAL));
      // Live matches set an activity-adaptive cadence (fast when buzz is rising,
      // calm when flat; knockouts always fast); a window with only warmup/cooldown
      // nations ticks on the slow tier; nothing active → request-free re-check.
      let nextDelay = pickDelay();
      try {
        await cycle(context); // handles the empty/idle case (clears signals) itself
        nextDelay = pickDelay(); // recompute: cycle() may have updated liveActivity
      } catch (e) {
        stats.errors++;
        stats.lastEvent = 'cycle error: ' + e.message;
        log.error('[buzz-counts]', e.message);
        // keep the context-appropriate delay above (fast retry while live)
      }
      stats.nextDelayMs = nextDelay;
      // If X rate-limited us, don't tick again until its reset window passes.
      if (stats.pausedUntilMs && stats.pausedUntilMs > Date.now()) {
        nextDelay = Math.max(nextDelay, stats.pausedUntilMs - Date.now() + 1_000);
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

module.exports = { createCountsPoller, activeTeamCodes, liveContext, computeTrend, resolveBuzzMode, dueForFetch, liveDelay, isKnockout, absoluteScale, decayPeak };
