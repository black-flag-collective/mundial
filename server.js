const express = require('express');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;
const DATA_PATH = path.join(__dirname, 'data', 'matches.json');
const INITIAL_DATA_PATH = path.join(__dirname, 'data', 'matches.json');

// Ensure data directory exists
fs.mkdirSync(path.dirname(DATA_PATH), { recursive: true });

// Canonical host: redirect www.mundial.buzz → mundial.buzz (preserving path + query).
// The app is served over HTTPS (Fly force_https), so always redirect to https.
app.use((req, res, next) => {
  const host = (req.hostname || '').toLowerCase();

  if (host === 'www.mundial.buzz') {
    return res.redirect(301, `https://mundial.buzz${req.originalUrl}`);
  }

  next();
});

// Lightweight liveness probe for Fly health checks / uptime monitors.
// Kept above static so it never touches the filesystem.
app.get('/healthz', (req, res) => {
  res.json({ status: 'ok', uptime: process.uptime() });
});

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
    res.json(buzz.snapshot());
  } catch (err) {
    console.error('Failed to serve buzz.json:', err.message);
    res.status(503).json({ error: 'buzz not available' });
  }
});

// ── Live X buzz stream (optional) ──────────────────────────────────────────
// One upstream X Filtered Stream connection per process feeds the buzz engine
// (per-country signal) AND is relayed to every browser over Server-Sent Events.
// Runs only when X_BEARER_TOKEN is set; otherwise this is inert and the app's
// simulated buzz is unchanged. See docs/X-API-REALTIME.md.
const { runForever } = require('./scripts/x-stream-runner');
const { RULES_URL } = require('./scripts/x-rules');

const sseClients = new Set();
const recentPosts = []; // small ring buffer so new SSE clients get instant context
const RECENT_MAX = 50;

// Live X-stream telemetry, surfaced at GET /api/x/health for the Buzz Monitor.
const xStats = {
  tokenConfigured: !!process.env.X_BEARER_TOKEN,
  streamConnected: false,
  lastEvent: process.env.X_BEARER_TOKEN ? 'starting…' : 'no token',
  reconnects: 0,
  totalPosts: 0,
  postTimestamps: [], // ms; trimmed to the last 60s on read
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
  const now = Date.now();
  xStats.postTimestamps = xStats.postTimestamps.filter((t) => now - t < 60000);
  res.set('Cache-Control', 'no-store');
  res.json({
    tokenConfigured: xStats.tokenConfigured,
    streamConnected: xStats.streamConnected,
    lastEvent: xStats.lastEvent,
    reconnects: xStats.reconnects,
    throughputPerMin: xStats.postTimestamps.length,
    totalPosts: xStats.totalPosts,
    lastPullMs: xStats.lastPullMs,
    activeRules: xStats.activeRules,
    rateRemaining: xStats.rateRemaining,
    rateCap: xStats.rateCap,
    rateResetMs: xStats.rateResetMs,
  });
});

app.get('/api/buzz/stream', (req, res) => {
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
  const ping = setInterval(() => res.write(': ping\n\n'), 20000);
  req.on('close', () => {
    clearInterval(ping);
    sseClients.delete(res);
  });
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

  const tags = (payload.matching_rules || []).map((r) => r.tag).filter(Boolean);
  for (const code of tags) buzz.ingest(code); // tag === FIFA code (see x-build-rules.js)

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
    const raw = fs.existsSync(DATA_PATH)
      ? fs.readFileSync(DATA_PATH, 'utf8')
      : fs.readFileSync(INITIAL_DATA_PATH, 'utf8');

    const data = JSON.parse(raw);

    // Dynamically mark today on every request so the slider always opens
    // on the current match day without needing to update the data file.
    const now = new Date();
    const todayShort = now.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    let foundToday = false;
    data.days.forEach(d => {
      d.today = (d.short === todayShort);
      if (d.today) foundToday = true;
    });
    // If no match day for today, mark the last known day
    if (!foundToday && data.days.length) {
      data.days[data.days.length - 1].today = true;
    }

    // Short TTL: data refreshes at most every ~30 min and the `today` flag only
    // flips at midnight, so a 60s cache cuts load without serving stale scores.
    res.set('Cache-Control', 'public, max-age=60');
    res.json(data);
  } catch (err) {
    console.error('Failed to serve data.json:', err.message);
    res.status(503).json({ error: 'data not available' });
  }
});

app.listen(PORT, () => {
  console.log(`Mundial server running on port ${PORT}`);

  // Start the buzz engine (no API key required — simulated/goal-derived source).
  buzz.start();

  // Start the live X Filtered Stream if configured. No-ops without
  // X_BEARER_TOKEN, and X_STREAM_DISABLED=1 forces it off (e.g. on secondary
  // Fly machines — the stream allows only one concurrent connection).
  if (process.env.X_STREAM_DISABLED !== '1') {
    runForever(onXPost, {
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

// NOTE: Match data is refreshed by the "Update match data" GitHub Action
// (.github/workflows/update-data.yml), which runs scripts/update-data.js on a
// schedule and commits data/matches.json back to the repo. The server no longer
// runs the updater in-process: Fly machines have no persistent volume and reset
// their filesystem on restart/redeploy, so in-process writes were silently lost
// (and never ran at all while the machine was auto-stopped). Committing to the
// repo persists the data and triggers a redeploy with the fresh scores.
