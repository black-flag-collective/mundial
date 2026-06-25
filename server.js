const express = require('express');
const fs = require('fs');
const path = require('path');
const { createRateLimiter, clientIp } = require('./scripts/rate-limit');
const { PostHog, setupExpressRequestContext, setupExpressErrorHandler } = require('posthog-node');

const app = express();
const PORT = process.env.PORT || 3000;
const DATA_PATH = path.join(__dirname, 'data', 'matches.json');

// Don't advertise the framework.
app.disable('x-powered-by');

// Ensure data directory exists
fs.mkdirSync(path.dirname(DATA_PATH), { recursive: true });

// Read-through cache for the match data, keyed by file mtime. matches.json only
// changes on redeploy (a fresh process), so within a process it's effectively
// static — this avoids a sync read + JSON.parse on every /api/data.json and
// /api/predict request. Throws on a missing/unreadable file so callers can 503.
// IMPORTANT: callers must NOT mutate the returned object (it's shared).
let _matchesCache = null;
let _matchesMtime = -1;
function readMatches() {
  const mtime = fs.statSync(DATA_PATH).mtimeMs;
  if (_matchesCache === null || mtime !== _matchesMtime) {
    _matchesCache = JSON.parse(fs.readFileSync(DATA_PATH, 'utf8'));
    _matchesMtime = mtime;
  }
  return _matchesCache;
}

// Baseline security headers on every response. Proportionate for a public,
// read-only site: stop MIME-sniffing and clickjacking, trim the referrer, deny
// unused device APIs, and pin HTTPS. (No strict CSP — the app is an inline-heavy
// Design Component runtime pulling a few CDNs; a meaningful policy would need
// 'unsafe-inline'/'unsafe-eval' and buy little, so it's deliberately omitted.)
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'geolocation=(), microphone=(), camera=(), interest-cohort=()');
  res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  next();
});

// Canonical host: redirect www.mundial.buzz → mundial.buzz (preserving path + query).
// The app is served over HTTPS (Fly force_https), so always redirect to https.
app.use((req, res, next) => {
  const host = (req.hostname || '').toLowerCase();

  if (host === 'www.mundial.buzz') {
    return res.redirect(301, `https://mundial.buzz${req.originalUrl}`);
  }

  next();
});

// Generous per-IP rate limit on the dynamic /api endpoints. Tuned so a normal
// browser tab's polling (~20 req/min) is nowhere near the cap, but a single IP
// hammering an endpoint is throttled. Static assets and /healthz aren't limited
// (cheap, and Fly's health checks hit /healthz often); /api/predict is excluded
// because it already self-limits (per-IP interval + cache + daily cap).
const apiLimiter = createRateLimiter({
  windowMs: Number(process.env.RATE_LIMIT_WINDOW_MS) || 60_000,
  max: Number(process.env.RATE_LIMIT_MAX) || 1200,
});
app.use('/api', (req, res, next) => {
  if (req.path === '/predict') return next();
  return apiLimiter.middleware(req, res, next);
});
setInterval(apiLimiter.prune, 60_000).unref();

// Lightweight liveness probe for Fly health checks / uptime monitors.
// Kept above static so it never touches the filesystem.
app.get('/healthz', (req, res) => {
  res.json({ status: 'ok', uptime: process.uptime() });
});

// Analytics bootstrap: serves the PostHog web snippet with the project key
// injected from POSTHOG_KEY. Same on/off pattern as the Oracle and X buzz layer
// — when the secret is unset (local dev, forks) this returns an inert no-op and
// the site loads with zero analytics. The key (phc_…) is a publishable client
// key, so shipping it to the browser is expected. Set it as a Fly secret in
// prod / a GitHub Actions secret in CI, never committed. Served above static so
// it wins over any real /analytics.js file and never touches the filesystem.
const POSTHOG_KEY = process.env.POSTHOG_KEY || '';
const POSTHOG_HOST = process.env.POSTHOG_HOST || 'https://us.i.posthog.com';
const analyticsJs = POSTHOG_KEY
  ? `!function(t,e){var o,n,p,r;e.__SV||(window.posthog=e,e._i=[],e.init=function(i,s,a){function g(t,e){var o=e.split(".");2==o.length&&(t=t[o[0]],e=o[1]),t[e]=function(){t.push([e].concat(Array.prototype.slice.call(arguments,0)))}}(p=t.createElement("script")).type="text/javascript",p.crossOrigin="anonymous",p.async=!0,p.src=s.api_host.replace(".i.posthog.com","-assets.i.posthog.com")+"/static/array.js",(r=t.getElementsByTagName("script")[0]).parentNode.insertBefore(p,r);var u=e;for(void 0!==a?u=e[a]=[]:a="posthog",u.people=u.people||[],u.toString=function(t){var e="posthog";return"posthog"!==a&&(e+="."+a),t||(e+=" (stub)"),e},u.people.toString=function(){return u.toString(1)+".people (stub)"},o="init capture register register_once register_for_session unregister unregister_for_session getFeatureFlag getFeatureFlagPayload isFeatureEnabled reloadFeatureFlags updateEarlyAccessFeatureEnrollment getEarlyAccessFeatures on onFeatureFlags onSessionId getSurveys getActiveMatchingSurveys renderSurvey canRenderSurvey getNextSurveyStep identify setPersonProperties group resetGroups setPersonPropertiesForFlags resetPersonPropertiesForFlags setGroupPropertiesForFlags resetGroupPropertiesForFlags reset get_distinct_id getGroups get_session_id get_session_replay_url alias set_config startSessionRecording stopSessionRecording sessionRecordingStarted captureException loadToolbar get_property getSessionProperty createPersonProfile opt_in_capturing opt_out_capturing has_opted_in_capturing has_opted_out_capturing clear_opt_in_out_capturing debug getPageViewId captureTraceFeedback captureTraceMetric".split(" "),n=0;n<o.length;n++)g(u,o[n]);e._i.push([i,s,a])},e.__SV=1)}(document,window.posthog||[]);\nposthog.init(${JSON.stringify(POSTHOG_KEY)},{api_host:${JSON.stringify(POSTHOG_HOST)},defaults:'2025-05-24',person_profiles:'identified_only'});`
  : '/* PostHog analytics disabled: POSTHOG_KEY is not set. */';
app.get('/analytics.js', (req, res) => {
  res.type('text/javascript; charset=utf-8');
  // Key is injected from env at request time, so don't let proxies/browsers
  // pin a stale copy after a secret rotation.
  res.setHeader('Cache-Control', 'no-store');
  res.send(analyticsJs);
});

// Server-side PostHog analytics (posthog-node). Shares the same key/host as the
// client snippet above. No-ops gracefully when POSTHOG_KEY is unset (local dev).
const posthog = POSTHOG_KEY
  ? new PostHog(POSTHOG_KEY, { host: POSTHOG_HOST, enableExceptionAutocapture: true })
  : null;
if (posthog) setupExpressRequestContext(posthog, app);

app.use(express.static(path.join(__dirname, 'public'), {
  // Cache fingerprint-free assets for an hour, but always revalidate the app
  // shell so HTML/data changes ship immediately on the next request.
  maxAge: '1h',
  setHeaders: (res, filePath) => {
    if (filePath.endsWith('index.html')) {
      res.setHeader('Cache-Control', 'no-cache');
    }
  }
}));

// Live buzz layer: per-country social intensity for the globe beacons.
const { getEngine } = require('./scripts/buzz-engine');
const buzz = getEngine();

app.get('/api/buzz.json', (req, res) => {
  try {
    res.set('Cache-Control', 'no-store');
    const snap = buzz.snapshot();
    snap.oracle = !!oracleClient; // lets the UI show the "Ask the Oracle" button without probing it
    // Tell the truth about the source: when the counts poller is live and not
    // capped, in-play nations are driven by real X post volume. Otherwise buzz
    // is idle (zeros) — there is no simulated fallback.
    if (countsPoller) {
      const st = countsPoller.stats();
      const live = st.enabled && !st.capped && (st.activeTeams || []).length > 0;
      // Honesty about what's driving the globe: 'counts' = real live X volume;
      // otherwise 'trends' if the ambient (trending-nations) floor is lighting it
      // up between matches; otherwise 'idle' (dark). The trends poller owns the
      // ambient channel, so read its live count rather than the counts poller's.
      const ts = trendsPoller.stats();
      const ambientLit = !!(ts && ts.ambientCount > 0);
      snap.source = live ? 'counts' : (ambientLit ? 'trends' : 'idle');
      snap.phase = st.phase || 'idle';
      snap.activeTeams = st.activeTeams || [];
      snap.lastPollMs = st.lastPollMs || null;
      snap.windowMin = st.windowMin || null;
      // Tournament-wide chatter heartbeat (one slow-tier counts request while live).
      if (st.tournamentTotal != null) snap.tournamentTotal = st.tournamentTotal;
      if (st.tournamentTrend != null) snap.tournamentTrend = st.tournamentTrend;
      // Honesty flags: while paused (X rate-limited) or capped (daily budget hit)
      // the numbers are held from the last poll, not fresh — let the UI say so.
      snap.paused = !!st.rateLimited;
      snap.capped = !!st.capped;
      // Surface per-country momentum (rising/falling) so the UI can flag what's
      // "trending right now". Only the polled (in-play) nations carry a trend.
      const perTeam = st.perTeam || {};
      for (const b of snap.buzz) {
        if (perTeam[b.code]) b.trend = perTeam[b.code].trend;
      }
    } else if (snap.source === 'idle') {
      // Stream mode (no counts poller): the ambient trends floor can still light
      // the globe between matches, so report that honestly rather than 'idle'.
      const ts = trendsPoller.stats();
      if (ts && ts.ambientCount > 0) snap.source = 'trends';
    }
    res.json(snap);
  } catch (err) {
    console.error('Failed to serve buzz.json:', err.message);
    res.status(503).json({ error: 'buzz not available' });
  }
});

// What's trending on X per location (worldwide + host nations). Empty until the
// trends poller has a token and has run; the UI degrades gracefully.
app.get('/api/trends.json', (req, res) => {
  res.set('Cache-Control', 'no-store');
  res.json({ ...trendsPoller.snapshot(), health: trendsPoller.stats() });
});

// Buzz Oracle: on-demand, cost-bounded AI tournament prediction. GET so it's a
// trivial fetch from the UI; the heavy lifting (cache, rate limit, daily cap) is
// inside the oracle. `available:false` lets the UI hide the button cleanly.
app.get('/api/predict', async (req, res) => {
  res.set('Cache-Control', 'no-store');
  if (!oracleClient) return res.status(200).json({ available: false });
  try {
    const matches = readMatches(); // read-only here; safe to share the cache
    const buzzSnap = buzz.snapshot();
    // Which nations carry REAL X volume right now (live match + counts uncapped),
    // so the Oracle's context honestly separates measured from modeled buzz.
    const cs = countsPoller ? countsPoller.stats() : null;
    const realActive = !!(cs && cs.enabled && !cs.capped && (cs.activeTeams || []).length > 0);
    const liveCodes = realActive ? cs.activeTeams : [];
    const context = buildContext({ matches, buzz: buzzSnap, trends: trendsPoller.snapshot(), liveCodes, realActive });
    const signature = signatureOf(buzzSnap);
    const out = await oracle.predict({ context, signature, ip: clientIp(req), distinctId: req.headers['x-posthog-distinct-id'] || clientIp(req), validCodes: fieldCodes(matches) });
    res.json({ available: true, ...out });
    if (posthog) {
      const distinctId = req.headers['x-posthog-distinct-id'] || clientIp(req);
      posthog.capture({
        distinctId,
        event: out.cached ? 'oracle_prediction_cached' : 'oracle_prediction_requested',
        properties: {
          champion: out.prediction && out.prediction.champion,
          champion_name: out.prediction && out.prediction.championName,
          generated_at: out.generatedAt,
        },
      });
    }
  } catch (err) {
    // Known states (rate-limit 429, capped/unconfigured 503, unreadable 502)
    // carry user-safe messages; anything else is an unexpected 500 — log the
    // detail server-side, return a generic message so internals don't leak.
    const status = err.status || 500;
    if (status === 500) console.error('[oracle] predict failed:', err.message);
    if (posthog) {
      const distinctId = req.headers['x-posthog-distinct-id'] || clientIp(req);
      if (status === 429) {
        posthog.capture({ distinctId, event: 'oracle_request_rate_limited' });
      } else if (status === 503) {
        posthog.capture({ distinctId, event: 'oracle_daily_cap_reached' });
      }
    }
    res.status(status).json({ available: true, error: status === 500 ? 'the Oracle is unavailable right now' : err.message });
  }
});

// ── Live X buzz stream (optional) ──────────────────────────────────────────
// One upstream X Filtered Stream connection per process feeds the buzz engine
// (per-country signal) AND is relayed to every browser over Server-Sent Events.
// Runs only when X_BEARER_TOKEN is set; otherwise this is inert and buzz stays
// idle (zeros) — there is no simulated signal. See docs/X-API-REALTIME.md.
const { runForever } = require('./scripts/x-stream-runner');
const { postWeight } = require('./scripts/x-stream');
const { RULES_URL } = require('./scripts/x-rules');
const { createCountsPoller, resolveBuzzMode } = require('./scripts/buzz-counts');
const { createTrendsPoller } = require('./scripts/x-trends');
const { createOracle, buildContext, signatureOf, fieldCodes } = require('./scripts/predict');

// X Trends (what's trending per location) runs alongside whichever buzz source —
// it's a separate, per-location read, billed independently and very cheaply. It
// also feeds a low ambient glow into the buzz engine (nations trending on X light
// up the globe between matches) — derived from the same poll, so no extra cost.
const trendsPoller = createTrendsPoller({ engine: buzz });

// Buzz Oracle — on-demand, cost-bounded AI tournament prediction. Only wired up
// when an API key is present; otherwise the endpoint reports it's unavailable
// and the UI hides the button. The client is created lazily to avoid requiring
// the SDK at boot when there's no key.
let oracleClient = null;
let oracleObserved = false;
if (process.env.ANTHROPIC_API_KEY) {
  try {
    if (posthog) {
      // PostHog AI observability: route Oracle calls through the @posthog/ai
      // wrapper so each prediction is captured as an $ai_generation event
      // (model, token counts, cost, latency), tied to the same project and
      // distinct IDs as the oracle_* events we already capture. (No maxRetries
      // option on the wrapper — the underlying SDK still defaults to 2.)
      const { Anthropic } = require('@posthog/ai');
      oracleClient = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY, posthog });
      oracleObserved = true;
    } else {
      // No POSTHOG_KEY → plain SDK, no AI analytics (same opt-out as the rest).
      const Anthropic = require('@anthropic-ai/sdk');
      oracleClient = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY, maxRetries: 2 });
    }
  } catch (err) {
    console.error('[oracle] SDK unavailable:', err.message);
  }
}
const oracle = createOracle({ client: oracleClient, aiObservability: oracleObserved });

// Aborting this on shutdown drops the X connection promptly so the single
// allowed stream slot is released before a redeploy's new machine connects
// (prevents the rolling-deploy 409/429 connection churn).
const xStreamController = new AbortController();

// Buzz source selector. Cost-safe by default: with a token set, we use the
// cost-bounded **counts** poller unless the operator explicitly opts into the
// (billed-per-post) firehose with X_BUZZ_MODE=stream. Without a token both are
// inert and buzz stays idle (zeros) — there is no simulated signal. This makes
// the cheap path the default a forker gets just by setting X_BEARER_TOKEN — the
// expensive firehose is opt-in.
const BUZZ_MODE = resolveBuzzMode(process.env);
const countsPoller = BUZZ_MODE === 'counts' ? createCountsPoller({ engine: buzz }) : null;

const sseClients = new Set();
const recentPosts = []; // small ring buffer so new SSE clients get instant context
const RECENT_MAX = 50;
const SSE_MAX = Number(process.env.SSE_MAX_CLIENTS) || 200; // cap concurrent streams

// Live X-stream telemetry, surfaced at GET /api/x/health for the Buzz Monitor.
const xStats = {
  tokenConfigured: !!process.env.X_BEARER_TOKEN,
  streamConnected: false,
  lastEvent: process.env.X_BEARER_TOKEN ? 'starting…' : 'no token',
  reconnects: 0,
  totalPosts: 0,
  postTimestamps: [], // ms; trimmed to the last 60s on read
  postsByCountry: {}, // FIFA code -> posts seen this process (observability)
  lastPullMs: null,
  activeRules: null,
  rateRemaining: null,
  rateCap: null,
  rateResetMs: null,
};

// Periodically read the rules endpoint for the active-rule count + rate-limit
// headers (the rules API is metered separately from the stream connection).
async function refreshRulesStats() {
  if (!process.env.X_BEARER_TOKEN) return;
  try {
    const r = await fetch(RULES_URL, { headers: { Authorization: `Bearer ${process.env.X_BEARER_TOKEN}` } });
    const rem = r.headers.get('x-rate-limit-remaining');
    const lim = r.headers.get('x-rate-limit-limit');
    const reset = r.headers.get('x-rate-limit-reset');
    if (rem != null) xStats.rateRemaining = Number(rem);
    if (lim != null) xStats.rateCap = Number(lim);
    if (reset != null) xStats.rateResetMs = Number(reset) * 1000;
    const body = await r.json().catch(() => ({}));
    xStats.activeRules = Array.isArray(body.data) ? body.data.length : 0;
  } catch (err) {
    console.error('[x-stream] rules stats refresh failed:', err.message);
  }
}

app.get('/api/x/health', (req, res) => {
  res.set('Cache-Control', 'no-store');

  // Counts mode: report the poller's cost-bounded telemetry instead of stream stats.
  if (countsPoller) {
    return res.json({ mode: 'counts', ...countsPoller.stats() });
  }

  const now = Date.now();
  xStats.postTimestamps = xStats.postTimestamps.filter((t) => now - t < 60000);
  // Top nations by posts seen this process — observability parity with counts mode.
  const topCountries = Object.entries(xStats.postsByCountry)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([code, posts]) => ({ code, posts }));
  res.json({
    mode: process.env.X_STREAM_DISABLED === '1' ? 'off' : 'stream',
    tokenConfigured: xStats.tokenConfigured,
    streamConnected: xStats.streamConnected,
    lastEvent: xStats.lastEvent,
    reconnects: xStats.reconnects,
    throughputPerMin: xStats.postTimestamps.length,
    totalPosts: xStats.totalPosts,
    topCountries,
    lastPullMs: xStats.lastPullMs,
    activeRules: xStats.activeRules,
    rateRemaining: xStats.rateRemaining,
    rateCap: xStats.rateCap,
    rateResetMs: xStats.rateResetMs,
  });
});

app.get('/api/buzz/stream', (req, res) => {
  // Cap concurrent streams so a client can't open thousands and exhaust sockets/
  // memory. Beyond the cap, ask them to retry shortly.
  if (sseClients.size >= SSE_MAX) {
    if (posthog) posthog.capture({ distinctId: req.headers['x-posthog-distinct-id'] || clientIp(req), event: 'buzz_stream_rejected', properties: { active_clients: sseClients.size, cap: SSE_MAX } });
    res.set('Retry-After', '30').status(503).json({ error: 'too many live connections, try again shortly' });
    return;
  }
  res.set({
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no', // disable proxy buffering so events flush immediately
  });
  if (res.flushHeaders) res.flushHeaders();
  res.write(': connected\n\n');
  for (const post of recentPosts) res.write(`data: ${JSON.stringify(post)}\n\n`);

  sseClients.add(res);
  if (posthog) posthog.capture({ distinctId: req.headers['x-posthog-distinct-id'] || clientIp(req), event: 'buzz_stream_connected', properties: { active_clients: sseClients.size } });
  const cleanup = () => { clearInterval(ping); sseClients.delete(res); };
  // Keep-alive ping; if the socket is already gone the write throws — clean up.
  const ping = setInterval(() => { try { res.write(': ping\n\n'); } catch { cleanup(); } }, 20000);
  req.on('close', cleanup);
});

// Per matched Post: feed the buzz engine by country, then fan out to SSE clients.
function onXPost(payload) {
  const post = payload && payload.data;
  if (!post) return;

  const ts = Date.now();
  xStats.totalPosts++;
  xStats.lastPullMs = ts;
  xStats.postTimestamps.push(ts);
  if (xStats.postTimestamps.length > 5000) xStats.postTimestamps.shift();

  // Weight the nudge by engagement so a viral post buzzes louder than a lone
  // reply (bounded — see postWeight). tag === FIFA code (see x-build-rules.js).
  const tags = (payload.matching_rules || []).map((r) => r.tag).filter(Boolean);
  const weight = postWeight(post);
  for (const code of tags) {
    buzz.ingest(code, weight);
    xStats.postsByCountry[code] = (xStats.postsByCountry[code] || 0) + 1;
  }

  const users = (payload.includes && payload.includes.users) || [];
  const author = users.find((u) => u.id === post.author_id);
  const msg = {
    id: post.id,
    text: post.text,
    createdAt: post.created_at,
    lang: post.lang,
    metrics: post.public_metrics,
    tags,
    author: author && {
      name: author.name,
      handle: author.username,
      avatar: author.profile_image_url,
    },
  };

  recentPosts.push(msg);
  if (recentPosts.length > RECENT_MAX) recentPosts.shift();

  const frame = `data: ${JSON.stringify(msg)}\n\n`;
  for (const client of sseClients) {
    try {
      client.write(frame);
    } catch {
      /* client went away mid-write; 'close' handler cleans it up */
    }
  }
}

app.get('/api/data.json', (req, res) => {
  try {
    const data = readMatches();

    // Dynamically mark today on every request so the slider always opens on the
    // current match day. Build a fresh days array — do NOT mutate the cached
    // object (it's shared across requests).
    const todayShort = new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    let foundToday = false;
    const days = (data.days || []).map(d => {
      const today = d.short === todayShort;
      if (today) foundToday = true;
      return { ...d, today };
    });
    // If no match day for today, mark the last known day.
    if (!foundToday && days.length) days[days.length - 1].today = true;

    // Short TTL: data refreshes at most every ~30 min and the `today` flag only
    // flips at midnight, so a 60s cache cuts load without serving stale scores.
    res.set('Cache-Control', 'public, max-age=60');
    res.json({ ...data, days });
  } catch (err) {
    console.error('Failed to serve data.json:', err.message);
    res.status(503).json({ error: 'data not available' });
  }
});

// Generic 404 + error handlers, registered last. These guarantee clients never
// see a stack trace or internal detail regardless of NODE_ENV — the real cause
// is logged server-side only.
app.use((req, res) => {
  res.status(404).json({ error: 'not found' });
});
if (posthog) setupExpressErrorHandler(posthog, app);
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  console.error('[server] unhandled error:', err && err.stack ? err.stack : err);
  if (res.headersSent) return;
  res.status(500).json({ error: 'internal error' });
});

const server = app.listen(PORT, () => {
  console.log(`Mundial server running on port ${PORT}`);

  // Start the buzz engine (no API key required; real-signal-only — stays at zero
  // until a live X feed or an observed goal event feeds it real intensity).
  buzz.start();

  // X Trends poller — independent of the buzz source; no-ops without a token.
  trendsPoller.start(xStreamController.signal);

  // Live buzz source. Counts mode (recommended, cost-bounded) supersedes the
  // firehose stream. Both honor graceful shutdown via xStreamController.
  if (BUZZ_MODE === 'counts') {
    countsPoller.start(xStreamController.signal);
    console.log('[buzz-counts] counts mode active (cost-bounded; firehose stream not used)');
  } else if (process.env.X_STREAM_DISABLED !== '1') {
    // Firehose filtered-stream path. No-ops without X_BEARER_TOKEN; X_STREAM_DISABLED=1
    // forces it off (e.g. on secondary Fly machines — one connection only).
    runForever(onXPost, {
      signal: xStreamController.signal,
      onStatus: (state, info) => {
        if (state === 'connected') {
          xStats.streamConnected = true;
          xStats.lastEvent = 'connected · 200 OK';
        } else if (state === 'reconnecting') {
          xStats.streamConnected = false;
          xStats.reconnects++;
          xStats.lastEvent = `${info && info.status ? 'HTTP ' + info.status : 'stream down'} · backing off`;
        } else if (state === 'closed') {
          xStats.streamConnected = false;
          xStats.lastEvent = 'stream closed · reconnecting';
        } else if (state === 'disabled') {
          xStats.streamConnected = false;
          xStats.lastEvent = 'no token';
        }
      },
    }).catch((err) => console.error('[x-stream] fatal:', err.message));

    // Active-rule count + rate-limit headers, refreshed periodically.
    if (process.env.X_BEARER_TOKEN) {
      refreshRulesStats();
      setInterval(refreshRulesStats, 60000);
    }
  }
});

// Graceful shutdown: Fly sends SIGTERM/SIGINT on redeploy or machine stop. Drop
// the X stream first so its single connection slot is freed before a new
// machine connects (otherwise the overlap throws 409 and burns the connection
// rate limit), close SSE clients, then exit. A short timer force-exits if the
// HTTP server is slow to drain.
let shuttingDown = false;
function shutdown(sig) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`[server] ${sig} received — releasing X stream and shutting down`);
  try { xStreamController.abort(); } catch { /* already aborted */ }
  for (const res of sseClients) { try { res.end(); } catch { /* client gone */ } }
  if (posthog) posthog.shutdown().catch(() => {});
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 4000).unref();
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

// NOTE: Match data is refreshed by the "Update match data" GitHub Action
// (.github/workflows/update-data.yml), which runs scripts/update-data.js on a
// schedule and commits data/matches.json back to the repo. The server no longer
// runs the updater in-process: Fly machines have no persistent volume and reset
// their filesystem on restart/redeploy, so in-process writes were silently lost
// (and never ran at all while the machine was auto-stopped). Committing to the
// repo persists the data and triggers a redeploy with the fresh scores.
