# Real-time World Cup activity via the X API (Filtered Stream)

How to pull **near real-time Posts** about the 2026 World Cup into mundial-buzz
using the **X API v2 Filtered Stream**. You define rules (teams, hashtags,
matches), hold open one persistent HTTP connection, and receive matching Posts
within ~6–7 seconds of publication.

> **Docs index:** the authoritative, machine-readable index of every X API page
> is at <https://docs.x.com/llms.txt> (v2 sub-index: <https://docs.x.com/x-api/llms.txt>).
> Fetch it to discover pages before exploring further. Direct links are collected
> in [Reference](#reference) at the bottom.

## Already wired in this repo

This integration is implemented — files, not just examples:

| File | Role |
| :--- | :--- |
| [`scripts/x-build-rules.js`](../scripts/x-build-rules.js) | Build one rule per nation, tagged with the FIFA code (`buildTeamRules()`; CLI prints `{add:[…]}`). |
| [`scripts/x-rules.js`](../scripts/x-rules.js) | Manage rules — `listRules` / `addRules` / `deleteRules` / `replaceRules`; CLI `list\|replace\|clear\|dry-run`. |
| [`scripts/x-stream.js`](../scripts/x-stream.js) | `streamPosts(onPost)` — one persistent connection, hydrated Posts, keep-alive aware. |
| [`scripts/x-stream-runner.js`](../scripts/x-stream-runner.js) | `runForever(onPost)` — reconnect with status-tuned backoff; no-ops without a token. |
| [`scripts/buzz-engine.js`](../scripts/buzz-engine.js) | `ingest(code, weight)` feeds per-country X volume into the existing buzz state. |
| [`server.js`](../server.js) | Starts the stream on boot, feeds the buzz engine, relays Posts at **`GET /api/buzz/stream`** (SSE), and exposes telemetry at **`GET /api/x/health`**. |
| [`public/buzz/`](../public/buzz/) | **Buzz Stream Monitor** page at **`/buzz`** — synced from claude.ai/design, wired to the SSE feed + `/api/x/health` (status tiles, live feed, Globe flag-bursts by matched nation). |

### Monitor page (`/buzz`)

Synced back from the claude.ai/design "Mundial UI" project (the agent built it as a
`templates/x-buzz-debug/` Design Component). It's a self-contained DC page on the
same runtime as the main app (`support.js` + the vendored `MundialUI` bundle under
`public/buzz/_ds/`), with its data layer rewired from the design-time simulation to
the live backend: posts ← `/api/buzz/stream`, stats ← `/api/x/health`. With no token
it renders a truthful **NO TOKEN / 0 posts** empty state. `GET /api/x/health` returns
`{ tokenConfigured, streamConnected, throughputPerMin, totalPosts, topCountries,
reconnects, activeRules, rateRemaining, rateCap, rateResetMs, lastEvent }`, where
`topCountries` is the most-seen nations this process (`[{ code, posts }]`) — the
stream-mode parallel to counts mode's `perTeam`.

**To turn it on:** set the `X_BEARER_TOKEN` secret and install rules once
(`node scripts/x-rules.js replace`). Without the token everything is inert and
the app's simulated buzz runs exactly as before. The sections below explain the
design; jump to [Quick start](#quick-start) to run it.

---

## Cost-effective mode: counts → buzz (recommended)

The filtered stream is billed **per post pulled** — during live matches with 48
broad rules that ran ~$5/min. The buzz engine only needs per-country *volume*,
not post bodies, so the cost-effective path asks X **how many** posts match
instead of pulling them — and only while a match is actually being played:

- **Counts, not stream** — [`scripts/buzz-counts.js`](../scripts/buzz-counts.js)
  polls `GET /2/tweets/counts/recent` per team (volume only; no bodies) and feeds
  it to the engine via `setSignals()`.
- **Live-window scoped** — driven by each fixture's absolute `ko` kickoff time,
  we poll only teams whose match is live (kickoff → +`MATCH_MIN`) plus a short
  post-match cooldown. **No live match → zero requests** (match state is read
  from disk for free), so a quiet tournament hour costs nothing.
- **Tiered cadence** — nations in a **live** match refresh every cycle
  (`LIVE_INTERVAL`, ~60s) so the globe pulses in near-real-time, while
  **warmup/cooldown** nations refresh on a slower tier (`SLOW_INTERVAL`, ~5m) —
  the budget goes where the action is. When nothing is live, a request-free
  re-check (`IDLE_INTERVAL`, ~10m) just watches for the next kickoff. A slow-tier
  nation keeps its last signal between refreshes, so the board stays stable.
- **Momentum, for free** — the counts response is per-minute, so each poll also
  yields a rising/falling **trend** per country and fires a **surge** (spike)
  on a sharp minute-over-minute jump — the goal-reaction pop — with no extra
  requests. Surfaced as `trend` per nation in `/api/buzz.json`.
- **Hard daily cap** — a request budget with a circuit breaker that pauses polling
  (buzz fades back to the free simulation) when hit.

**Counts is the default** when a token is set — you don't turn it on, you'd turn
it *off* by explicitly choosing the firehose (`X_BUZZ_MODE=stream`). Without a
token, both paths are inert and the free simulation runs. Tune with:

| Env | Default | Meaning |
| :-- | :-- | :-- |
| `X_BUZZ_MODE` | `counts` (with token) | set to `stream` to opt into the firehose instead |
| `X_COUNTS_LIVE_INTERVAL_MS` | `60000` (60s) | poll cadence for nations in a **live** match |
| `X_COUNTS_SLOW_INTERVAL_MS` | `300000` (5m) | poll cadence for **warmup/cooldown** nations |
| `X_COUNTS_IDLE_INTERVAL_MS` | `600000` (10m) | request-free re-check when nothing is live |
| `X_COUNTS_WINDOW_MIN` | `10` | recent-volume window per poll |
| `X_COUNTS_MATCH_MIN` | `150` | minutes after kickoff a match stays "live" |
| `X_COUNTS_WARMUP_MIN` | `0` | pre-kickoff hype window (off by default) |
| `X_COUNTS_COOLDOWN_MIN` | `30` | post-match reaction window |
| `X_COUNTS_DAILY_CAP` | `2000` | max requests/UTC-day (circuit breaker) |

### What it costs

Because spend is scoped to live windows, the bill tracks the schedule, not the
clock. Per match the live tier dominates: 2 teams × (~150 min ÷ 60 s) ≈ **300
requests**, plus a handful on the slow tier during the 30-min cooldown (2 teams ÷
5 min ≈ 12). Call it **~310 requests/match**. A busy group-stage day (4 matches)
≈ **1,250 requests/day**, under the 2,000 default cap; a whole 104-match
tournament ≈ **30–35k requests**. At the pay-per-use counts price
(~$0.005/request) that's a few dollars on a peak day and
on the order of **~$150 for the entire World Cup** — and **$0 on days with no
matches**. Want it cheaper? Raise `X_COUNTS_LIVE_INTERVAL_MS` (e.g. back to 90s),
raise `X_COUNTS_SLOW_INTERVAL_MS`, or lower the cap; the circuit breaker
guarantees you can't blow past the cap even if the schedule data is wrong.

If X **rate-limits** the counts endpoint (HTTP 429/420), the poller backs off
until the server's `x-rate-limit-reset` window instead of retrying every cycle —
so it never burns the daily budget earning more 429s. While paused it spends
nothing and the board holds its last-known counts; `rateLimited` + `pausedUntilMs`
surface the state.

`GET /api/x/health` reports `{mode:"counts", phase, activeTeams, requestsToday,
dailyCap, capped, rateLimited, pausedUntilMs, liveIntervalMs, slowIntervalMs,
idleIntervalMs, windowMin, nextPollMs, perTeam, rateRemaining, lastEvent, …}` —
`phase` is `live`/`warmup`/`cooldown`/`idle` and
`perTeam[code]` carries the exact query, post count, normalized signal, trend,
and — mined for free from the same per-minute response — the **peak** and
**current** per-minute rate plus the raw **`minutes`** series (which the Buzz
inspect panel draws as a sparkline). The **`/buzz`** page in this mode is a
free-spin **marble globe** (no
auto-focus; markers pulse harder where buzz is hotter) beside a **nation
leaderboard** — no per-post feed, so no per-post cost. Counts mode is the
default with a token set; the firehose stream path runs only when you explicitly
set `X_BUZZ_MODE=stream` (and `X_STREAM_DISABLED` isn't `1`).

---

## Trends: what's trending per location

Alongside the per-team *volume* signal, the **`GET /2/trends/by_woeid/{woeid}`**
endpoint gives the actual **trending topics** (name + post count) for a place —
the "what the world is watching" layer. It's billed **per location**, so polling
worldwide + the three host nations is a handful of requests per cycle, wholly
separate from (and far cheaper than) the 48-team counts budget.

[`scripts/x-trends.js`](../scripts/x-trends.js) polls those locations on a slow
cadence and serves the result at **`GET /api/trends.json`**:

```json
{
  "updatedAt": "…", "source": "x-trends",
  "locations": [{ "woeid": 1, "name": "Worldwide",
    "trends": [{ "name": "#WorldCup2026", "postCount": 50000, "wc": true }, …] }],
  "health": { "enabled": true, "requestsToday": 4, "dailyCap": 800, "capped": false, … }
}
```

Each trend is tagged `wc: true` when it looks World-Cup relevant (a nation name,
a `#CODE`, or a keyword like "world cup"/"fifa") so the UI can filter the noise.
Runs whenever `X_BEARER_TOKEN` is set (off with `X_TRENDS_DISABLED=1`); app-only
Bearer auth, no token → inert and `/api/trends.json` returns an empty set. Knobs:
`X_TRENDS_INTERVAL_MS` (default 10m), `X_TRENDS_DAILY_CAP` (800), `X_TRENDS_WOEIDS`.

---

## How it works (firehose stream)

```
1. Create rules   POST /2/tweets/search/stream/rules     ← teams, hashtags, matches
2. Connect        GET  /2/tweets/search/stream           ← one persistent connection
3. Receive Posts  (stream of JSON lines)                 ← each tagged with the rule(s) it matched
```

Rules are **persistent and server-side** — you add/remove them without
disconnecting the stream. The base host is `https://api.x.com` (the legacy
`api.twitter.com` host still resolves).

---

## Prerequisites

- An approved [X developer account](https://developer.x.com/en/portal) with a
  **Project + App**.
- The App's **Bearer Token** (Filtered Stream uses app-only OAuth 2.0 Bearer
  auth — no user context needed).
- Node ≥ 20 (this repo already requires it; `fetch` and web streams are global).

Store the token out of source control:

```bash
# .env (already gitignored in this repo)
X_BEARER_TOKEN=AAAAAAAA...your-app-bearer-token...
```

---

## Access tiers & limits

Filtered Stream is gated by your X API plan. The limits that shape an
integration:

| Feature                       | Pay-per-use | Enterprise          |
| :---------------------------- | :---------- | :------------------ |
| Rules per project             | 1,000       | 25,000+             |
| Rule length                   | 1,024 chars | 2,048 chars         |
| Concurrent stream connections | **1**       | Multiple            |
| Core operators                | ✓           | ✓                   |
| `embedding:` semantic operator| —           | ✓ (Embedding tier)  |

**Consequences for us:**

- **One connection.** Run the stream in **one** place (the Express server / a
  worker), never per-browser. Fan out to clients with SSE or WebSocket (see
  [Wiring into mundial-buzz](#wiring-into-mundial-buzz)).
- **Rule length cap.** Batch teams into a handful of rules, each under the cap
  (the [rule generator](#generating-rules-from-the-team-list) handles this).
- **Latency.** ~6–7 s P99. If you need lower, X's
  [Powerstream](https://docs.x.com/x-api/powerstream/introduction.md) is the
  enterprise alternative (same shape, different host).

Rules-management endpoints (`/rules`) and the stream connection have their own
rate limits — see [Rate limits](https://docs.x.com/x-api/fundamentals/rate-limits.md).

---

## Building rules

Rules use the same [operators](https://docs.x.com/x-api/posts/filtered-stream/integrate/operators.md)
as search. Combine with `AND` (space), `OR`, `-` (negate), and parentheses.

```
(#WorldCup2026 OR #FIFAWorldCup OR "World Cup") lang:en -is:retweet
```

### Rules useful for the tracker

| Goal                         | Rule (`tag`)                                                        |
| :--------------------------- | :----------------------------------------------------------------- |
| Tournament chatter           | `(#WorldCup2026 OR #FIFAWorldCup OR #FWC26) lang:en -is:retweet`   |
| One team's buzz              | `(#BRA OR "Brazil" OR "Brasil") (football OR soccer OR worldcup)`  |
| A specific match             | `("FRA" "SEN") (goal OR gol OR fulltime OR "full time")`           |
| Media only (for a wall)      | `#WorldCup2026 has:images -is:retweet`                             |
| Official accounts            | `(from:FIFAWorldCup OR from:FIFAcom) -is:reply`                    |

Common operators worth knowing: `from:`, `to:`, `@mention`, `#hashtag`,
`"exact phrase"`, `lang:en`, `has:images`, `has:videos`, `has:links`,
`is:retweet`, `is:reply`, `is:quote`. Negate any with a leading `-`.

> **Test before you commit a rule:** add `?dry_run=true` to the rules POST to
> validate syntax and see what *would* match, without activating it.

### Generating rules from the team list

Implemented in [`scripts/x-build-rules.js`](../scripts/x-build-rules.js). It emits
**one rule per nation, tagged with the FIFA code** — so every matched Post is
attributable to a country and can be fed straight into the buzz engine. Each
rule pairs the country name (+ aliases like `Brasil`, `Turkey`, `Ivory Coast`)
and the `#CODE` hashtag with a World-Cup context filter, excluding retweets:

```
("Brazil" OR "Brasil" OR #BRA) (#WorldCup2026 OR #FIFAWorldCup OR "world cup" OR worldcup) -is:retweet
```

48 rules, each ~130 chars — well under the 1,000-rule and 1,024-char pay-per-use
caps, so no batching is needed (per-team tags are what make per-country buzz
work). Run it:

```bash
node scripts/x-build-rules.js              # all 48 nations
node scripts/x-build-rules.js --fixtures   # only codes present in data/matches.json
```

Codes come from the embedded `CODE_NAME` map (kept in sync with
[`packages/mundial-ui/src/data/teams.ts`](../packages/mundial-ui/src/data/teams.ts));
`--fixtures` intersects them with the teams actually in `data/matches.json`.

---

## Managing rules

All three operations hit `/2/tweets/search/stream/rules` with the Bearer token.

```js
// scripts/x-rules.js
const BASE = 'https://api.x.com/2/tweets/search/stream/rules';
const auth = { Authorization: `Bearer ${process.env.X_BEARER_TOKEN}` };

export async function listRules() {
  const r = await fetch(BASE, { headers: auth });
  return r.json(); // { data?: [{id, value, tag}], meta: {...} }
}

export async function addRules(rules, { dryRun = false } = {}) {
  const url = dryRun ? `${BASE}?dry_run=true` : BASE;
  const r = await fetch(url, {
    method: 'POST',
    headers: { ...auth, 'Content-Type': 'application/json' },
    body: JSON.stringify({ add: rules }), // [{ value, tag }]
  });
  return r.json(); // includes meta.summary.created / .not_created and errors
}

export async function deleteRules(ids) {
  const r = await fetch(BASE, {
    method: 'POST',
    headers: { ...auth, 'Content-Type': 'application/json' },
    body: JSON.stringify({ delete: { ids } }),
  });
  return r.json();
}

// Replace the whole rule set (idempotent setup): delete all, then add.
export async function replaceRules(rules) {
  const current = await listRules();
  const ids = (current.data ?? []).map((x) => x.id);
  if (ids.length) await deleteRules(ids);
  return addRules(rules);
}
```

Always check the response `meta.summary` and `errors[]` — an invalid rule is
rejected individually (the others still apply), and the error tells you why.

---

## Connecting to the stream

Open the stream **once** with the expansions and fields you actually want, so
each Post arrives hydrated (author, timestamps, metrics) instead of bare IDs.

```js
// scripts/x-stream.js
const STREAM = 'https://api.x.com/2/tweets/search/stream';

// Ask for the data the tracker UI needs in one shot.
const params = new URLSearchParams({
  'tweet.fields': 'created_at,lang,public_metrics,entities,referenced_tweets',
  expansions: 'author_id,attachments.media_keys',
  'user.fields': 'name,username,profile_image_url,verified',
  'media.fields': 'url,preview_image_url,type',
});

export async function streamPosts(onPost, { signal } = {}) {
  const res = await fetch(`${STREAM}?${params}`, {
    headers: { Authorization: `Bearer ${process.env.X_BEARER_TOKEN}` },
    signal,
  });
  if (!res.ok) {
    throw Object.assign(new Error(`stream HTTP ${res.status}`), { status: res.status });
  }

  // The body is newline-delimited JSON, with blank keep-alive lines every ~20s.
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;                       // server closed → caller reconnects
    buf += decoder.decode(value, { stream: true });
    let nl;
    while ((nl = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      if (!line) continue;                 // keep-alive heartbeat — connection healthy
      try {
        onPost(JSON.parse(line));          // { data, includes, matching_rules }
      } catch {
        /* partial/non-JSON line — ignore */
      }
    }
  }
}
```

### Each matched Post

```json
{
  "data": {
    "id": "1234567893",
    "text": "GOOOAL! 🇧🇷 Brazil 2–1 Morocco #WorldCup2026",
    "author_id": "44196397",
    "created_at": "2026-06-18T20:14:05.000Z",
    "lang": "en",
    "public_metrics": { "retweet_count": 12, "reply_count": 3, "like_count": 88, "quote_count": 1 }
  },
  "includes": {
    "users": [{ "id": "44196397", "name": "…", "username": "…", "profile_image_url": "…" }]
  },
  "matching_rules": [{ "id": "…", "tag": "teams-batch-1" }]
}
```

`matching_rules[].tag` is how you route a Post — e.g. a `tag` of `BRA` sends it
to Brazil's feed. Resolve the author from `includes.users` by `author_id`. See
[Matching returned Posts](https://docs.x.com/x-api/posts/filtered-stream/integrate/matching-returned-tweets.md).

**Edited Posts** arrive with their full `edit_history_tweet_ids` — the latest ID
is the current version (dedupe on it). See
[Edit Posts](https://docs.x.com/x-api/fundamentals/edit-posts).

---

## Reconnection & resilience

A long-lived stream **will** drop. Treat disconnects as normal and reconnect
with backoff — the [official guidance](https://docs.x.com/x-api/fundamentals/handling-disconnections.md):

- **Heartbeat timeout:** if no data *and* no keep-alive for ~20 s, drop and
  reconnect. `streamPosts()` enforces this with a **stall watchdog** — each read
  races a silence timer (default 30 s, `X_STREAM_STALL_MS`); on timeout it
  cancels the reader (freeing X's single connection slot) and rejects with a
  `.stall` error so the supervisor reconnects, instead of blocking forever on a
  half-open socket that never errors on its own.
- **Backoff by failure type** (`backoff()` in `x-stream-runner.js`, unit-tested):
  - Network blip / stream stall → **linear** backoff (e.g. +250 ms up to ~16 s).
  - HTTP `429` (rate limit) or `420` → wait for the server's `x-rate-limit-reset`
    / `retry-after` window when known, else **exponential** (minutes scale).
  - HTTP `409` (another connection holds the slot) → **yield** 30 s → 5 m so the
    existing leader keeps it (rolling-deploy overlap resolves itself).
  - HTTP `5xx` → **exponential** backoff starting ~5 s, capped ~320 s.
- **One connection only** (pay-per-use): a second connection gets a `429` and
  *disconnects the first*. Guard against double-starting the worker (secondary
  Fly machines set `X_STREAM_DISABLED=1`).

```js
// scripts/x-stream-runner.js — supervise the stream with backoff.
import { streamPosts } from './x-stream.js';

export async function runForever(onPost) {
  let delay = 0;
  for (;;) {
    try {
      await streamPosts(onPost);            // returns only when the server closes
      delay = 0;                            // clean close → reset backoff
    } catch (err) {
      delay =
        err.status === 429 ? Math.min((delay || 60_000) * 2, 900_000) // 1m→15m
        : err.status >= 500 ? Math.min((delay || 5_000) * 2, 320_000) // 5s→~5m
        : Math.min((delay || 250) + 250, 16_000);                     // linear
      console.warn(`stream down (${err.status ?? err.message}); retry in ${delay}ms`);
    }
    if (delay) await new Promise((r) => setTimeout(r, delay));
  }
}
```

More: [Consuming streaming data](https://docs.x.com/x-api/fundamentals/consuming-streaming-data.md),
[Recovery & redundancy](https://docs.x.com/x-api/fundamentals/recovery-and-redundancy.md),
[High-volume capacity](https://docs.x.com/x-api/fundamentals/high-volume-capacity.md).

---

## How it's wired into mundial-buzz

The app is a single Express server ([`server.js`](../server.js)) feeding a
`.dc.html` SPA, with an existing [buzz engine](../scripts/buzz-engine.js) that
already models per-country "social intensity" for the globe beacons. Because
Filtered Stream allows **one** connection, the server owns it and does two
things per matched Post — both implemented in `server.js`:

1. **Feeds the buzz engine.** Each Post's `matching_rules[].tag` is a FIFA code,
   so `buzz.ingest(code, postWeight(post))` nudges that country's spike. The
   weight scales with engagement (likes + reposts + quotes + replies) via
   `postWeight()` — bounded to `[1, 8]` so a viral Post buzzes louder than a lone
   reply, but one mega-viral Post can't instantly max the spike. The engine's
   existing `tick()` decay means sustained X volume keeps a nation lit and a
   burst (goal, controversy) flares it — turning the simulated beacon layer into
   a real one.
2. **Relays to browsers over SSE** at `GET /api/buzz/stream`, with a small
   ring buffer so a newly-connected client immediately gets recent Posts.

Browser side:

```js
const es = new EventSource('/api/buzz/stream');
es.onmessage = (e) => {
  const post = JSON.parse(e.data);   // { id, text, author, metrics, tags:[CODE], … }
  addBuzzPost(post);                 // render in a buzz feed, or flash post.tags on the globe
};
```

**Operational notes (already handled in code):**

- **Token-gated.** No `X_BEARER_TOKEN` → the stream is inert and the simulated
  buzz runs unchanged. Setting the token activates it on next boot.
- **Single-connection limit.** Filtered Stream allows one concurrent connection.
  If you run multiple Fly machines, set `X_STREAM_DISABLED=1` on all but the
  primary so a second connection doesn't `429` and disconnect the first.
- **Rules stay current.** Re-run `node scripts/x-rules.js replace` whenever the
  qualified teams change (or wire it into [`scripts/update-data.js`](../scripts/update-data.js)).
  `replaceRules()` is idempotent (clears then re-adds).

---

## Quick start

```bash
# 1. Configure the App Bearer Token
echo 'X_BEARER_TOKEN=AAAA...your-token...' >> .env     # local
fly secrets set X_BEARER_TOKEN=AAAA...your-token...     # production

# 2. Preview the rules that will be installed (all 48 nations)
node scripts/x-build-rules.js | head -20
#    …or only teams in the current fixtures:
node scripts/x-build-rules.js --fixtures

# 3. Validate without applying, then install them
node scripts/x-rules.js dry-run
node scripts/x-rules.js replace

# 4. Confirm the active rule set
node scripts/x-rules.js list

# 5. Start the app — the stream connects automatically when the token is set
npm start
#    watch live Posts:  curl -N http://localhost:3000/api/buzz/stream
```

Multiple Fly machines? Set `X_STREAM_DISABLED=1` on all but one (single
concurrent connection). To remove all rules: `node scripts/x-rules.js clear`.

---

## Testing

All of the X integration's pure logic is unit-tested with `fetch` stubbed — no
network, no real token, no server. Run the whole suite with `npm test`
(also gates CI); the X/buzz pieces are:

| Suite | Covers |
| :--- | :--- |
| [`scripts/x-self-test.js`](../scripts/x-self-test.js) | Reconnect **backoff** policy per failure type (409/429/5xx/network); **rule** generation (one tagged rule per nation, length cap, context filter); the **counts poller** (live-window scoping, normalization, momentum/`computeTrend`, surge-on-jump, the daily-cap circuit breaker); the **stream** reader (NDJSON parse, keep-alive skip, split-line reassembly, the stall watchdog, non-OK status + rate-limit capture); and **`postWeight`** engagement bounds. |
| [`scripts/buzz-self-test.js`](../scripts/buzz-self-test.js) | The buzz engine's signal interface (`ingest` weighting, `surge` clamping, `setSignals` atomic replace), spike decay over `tick()`, the external-signal glow floor, and the `snapshot()` shape/ranking the globe consumes. |
| [`scripts/smoke-test.js`](../scripts/smoke-test.js) | Boots the server and asserts `/`, `/api/data.json`, and `/api/buzz.json` serve correctly. |

Stubbing pattern for the network paths:

```js
// counts: stub fetch to return a per-minute series, inject a fixed live context
global.fetch = async () => ({ ok: true, headers: { get: () => null },
  json: async () => ({ meta: { total_tweet_count: 130 }, data: [{ tweet_count: 10 }, { tweet_count: 110 }] }) });
createCountsPoller({ engine, context: () => ({ codes: ['BRA'], phase: 'live' }) });

// stream: a reader that never yields trips the stall watchdog
await streamPosts(() => {}, { stallMs: 40 }); // rejects with err.stall === true
```

---

## Reference

**Filtered Stream**
- [Introduction](https://docs.x.com/x-api/posts/filtered-stream/introduction.md)
- [Quickstart](https://docs.x.com/x-api/posts/filtered-stream/quickstart.md)
- [Build a rule](https://docs.x.com/x-api/posts/filtered-stream/integrate/build-a-rule.md)
- [Operators](https://docs.x.com/x-api/posts/filtered-stream/integrate/operators.md)
- [Matching returned Posts](https://docs.x.com/x-api/posts/filtered-stream/integrate/matching-returned-tweets.md)

**Endpoints**
- [Connect to stream — `GET /2/tweets/search/stream`](https://docs.x.com/x-api/stream/stream-filtered-posts.md)
- [Update rules — `POST /2/tweets/search/stream/rules`](https://docs.x.com/x-api/stream/update-stream-rules.md)
- [Get rules — `GET /2/tweets/search/stream/rules`](https://docs.x.com/x-api/stream/get-stream-rules.md)
- [Get rule counts](https://docs.x.com/x-api/stream/get-stream-rule-counts.md)

**Fundamentals**
- [Fields](https://docs.x.com/x-api/fundamentals/fields.md) · [Expansions](https://docs.x.com/x-api/fundamentals/expansions.md) · [Data dictionary](https://docs.x.com/x-api/fundamentals/data-dictionary/reference.md)
- [Consuming streaming data](https://docs.x.com/x-api/fundamentals/consuming-streaming-data.md) · [Handling disconnections](https://docs.x.com/x-api/fundamentals/handling-disconnections.md) · [Recovery & redundancy](https://docs.x.com/x-api/fundamentals/recovery-and-redundancy.md) · [High-volume capacity](https://docs.x.com/x-api/fundamentals/high-volume-capacity.md)
- [Rate limits](https://docs.x.com/x-api/fundamentals/rate-limits.md) · [Response codes & errors](https://docs.x.com/x-api/fundamentals/response-codes-and-errors.md) · [Authentication](https://docs.x.com/fundamentals/authentication/overview.md)

**Lower latency / higher volume (Enterprise)**
- [Powerstream](https://docs.x.com/x-api/powerstream/introduction.md) · [Volume (sampled) streams](https://docs.x.com/x-api/posts/volume-streams/introduction.md)

**Sample code**
- [Twitter/X API v2 sample code (GitHub)](https://github.com/xdevplatform/Twitter-API-v2-sample-code)
