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
| [`server.js`](../server.js) | Starts the stream on boot, feeds the buzz engine, and relays Posts to browsers at **`GET /api/buzz/stream`** (SSE). |

**To turn it on:** set the `X_BEARER_TOKEN` secret and install rules once
(`node scripts/x-rules.js replace`). Without the token everything is inert and
the app's simulated buzz runs exactly as before. The sections below explain the
design; jump to [Quick start](#quick-start) to run it.

---

## How it works

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
  reconnect.
- **Backoff by failure type:**
  - Network blip / stream stall → **linear** backoff (e.g. +250 ms up to ~16 s).
  - HTTP `429` (rate limit) or `420` → **exponential** backoff, minutes scale.
  - HTTP `5xx` → **exponential** backoff starting ~5 s, capped ~320 s.
- **One connection only** (pay-per-use): a second connection gets a `429` and
  *disconnects the first*. Guard against double-starting the worker.

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
   so `buzz.ingest(code)` nudges that country's spike. The engine's existing
   `tick()` decay means sustained X volume keeps a nation lit and a burst (goal,
   controversy) flares it — turning the simulated beacon layer into a real one.
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
