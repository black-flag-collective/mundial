# Match Data & Schedule Pipeline

How `mundial.buzz` keeps its World Cup 2026 schedule, scores, standings, and
bracket current — and the guarantees that keep that data accurate.

> Companion to the high-level [`HANDOFF.md`](../HANDOFF.md). This doc is the
> detailed reference for the **data layer** specifically.

---

## 1. The big picture

```
┌─────────────────────────────────────────────────────────────────────────┐
│  GitHub Action: "Update match data"  (.github/workflows/update-data.yml)  │
│  cron */30 + manual dispatch                                              │
│                                                                           │
│   node scripts/update-data.js                                            │
│     → Claude (claude-sonnet-4-6) + web_search tool finds WC2026 results   │
│     → mergeUpdate() patches data/matches.json  (additive, validated)      │
│     → commit to main  ── ONLY IF match content actually changed           │
│     → flyctl deploy --remote-only  ── ONLY IF a commit was made           │
└─────────────────────────────────────────────────────────────────────────┘
                                   │
                                   ▼  (new image with new data/matches.json)
┌─────────────────────────────────────────────────────────────────────────┐
│  Fly.io machine  (server.js, Express)                                     │
│   GET /api/data.json → reads data/matches.json, injects per-request       │
│                        `today` flag, returns JSON                         │
└─────────────────────────────────────────────────────────────────────────┘
                                   │
                                   ▼  fetch('/api/data.json')
┌─────────────────────────────────────────────────────────────────────────┐
│  Browser app (public/index.html)                                          │
│   _loadLiveData() swaps days[] + dayMatches[] into the running app and    │
│   re-derives Standings + Bracket from the scores.                         │
└─────────────────────────────────────────────────────────────────────────┘
```

The data file is **baked into the Docker image at build time** — Fly machines
have no persistent volume and reset their filesystem on restart/redeploy. So the
live site only changes when Fly **redeploys**. That single fact drives most of
the design below.

---

## 2. The data model — `data/matches.json`

```jsonc
{
  "updatedAt": "2026-06-19T05:49:56.044Z",   // ISO; set by saveData() on each real write
  "days": [
    { "dow": "Thursday", "short": "Jun 18", "long": "June 18" }
  ],
  "dayMatches": [
    [
      { "g": "B", "a": "CAN", "b": "QAT", "as": 2, "bs": 0, "st": "FT",
        "venue": "BC Place, Vancouver" },
      { "g": "C", "a": "BRA", "b": "HAI", "st": "UP", "time": "9:00 PM ET",
        "venue": "..." }
    ]
  ]
}
```

| Field        | Meaning |
|--------------|---------|
| `days[i]`    | A match day. **Positionally aligned** with `dayMatches[i]`. |
| `dayMatches[i]` | Array of matches played that day. |
| `g`          | Group letter `A`–`L` (12 groups of 4). |
| `a`, `b`     | FIFA 3-letter team codes. Must be from the fixed `TEAM_CODES` list in `update-data.js`. |
| `as`, `bs`   | Goals for team `a` / team `b` (integers). Present once a score is known. |
| `st`         | `"UP"` (upcoming, has `time`), `"LIVE"`, or `"FT"` (final). |
| `time`       | Kickoff time, for `UP` matches only. Removed when a score lands. |
| `venue`      | Stadium string (display-only). |
| `today`      | **Not stored.** Injected per-request by the server (see §4). |

### Invariants (enforced in code)

1. **`days.length === dayMatches.length`** — they are parallel arrays.
   *(checked by the smoke test)*
2. **A fixture appears on exactly one day.** A team-pair `{a,b}` is a stable
   fixture id (group-stage pairs are unique), so the same match must never be
   scheduled twice. *(enforced in `mergeUpdate`; checked by the smoke test)*
3. **A confirmed final (`st: "FT"`) is immutable.** Once a score is recorded as
   final it is never overwritten. *(enforced in `mergeUpdate`)*
4. **Updates are additive.** The updater only *adds* new days/fixtures and
   *promotes* not-yet-final matches to a score. It never deletes.

---

## 3. The updater — `scripts/update-data.js`

Run by the GitHub Action (or locally: `npm run update`, needs `ANTHROPIC_API_KEY`).

**Flow:**
1. `loadCurrentData()` reads the existing `data/matches.json`.
2. Builds a prompt listing every still-`UP` fixture and the last known day, then
   asks Claude (`claude-sonnet-4-6`) with the `web_search` tool (capped at 3
   searches to stay under the input-token rate limit) for new results.
3. Claude returns a JSON block inside `<match_data>…</match_data>` with
   `new_days` and `updated_matches`.
4. **`mergeUpdate(current, update)`** applies it and returns `{ data, changed }`:
   - **`new_days`** — for each match, skip it if its team-pair already exists
     anywhere (dedup, invariant #2). New fixtures are appended to the matching
     day, or a brand-new day is created. Empty/all-dupe days are dropped.
   - **`updated_matches`** — locate the fixture (order-independent), and patch it
     **only if it isn't already `FT`** (invariant #3) **and** the incoming status
     is `FT`/`LIVE`. Scores are flipped if Claude reported the teams in the
     opposite order. A patch that wouldn't change anything is ignored.
   - `changed` is `true` only when match content actually moved.
5. **Save gate:** if `changed` is false, the file is **not** rewritten. This
   matters because `saveData()` bumps `updatedAt` unconditionally — without the
   gate, every run would produce a timestamp-only diff, a commit, and a
   pointless redeploy.

### Resilience
- The Anthropic SDK is configured with `maxRetries: 5` (honors `retry-after`).
- A persistent `429` after retries is swallowed (logged, run skipped) rather than
  failing the job — the next cron tick retries. A flaky rate limit shouldn't turn
  the Action red or spam notifications.

---

## 4. Serving — `server.js`

- `GET /api/data.json` reads `data/matches.json` and, **per request**, sets
  `today: true` on the day whose `short` matches the server's current date (or the
  last day if the tournament hasn't reached today). This is why `today` isn't
  stored — the slider always opens on the right day without a data change.
  Response is cached `public, max-age=60`.
- `index.html` is served `Cache-Control: no-cache` so app/data changes ship on the
  next request; other static assets get `max-age=1h`.
- `GET /healthz` is a filesystem-free liveness probe for Fly health checks.
- `www.mundial.buzz` 301-redirects to the apex `mundial.buzz`.
- (Sibling feature: `GET /api/buzz.json` is served by `scripts/buzz-engine.js` —
  unrelated to match data.)

---

## 5. Deploy mechanics & the `GITHUB_TOKEN` gotcha

There are **two** workflows that can deploy:

| Workflow | Trigger | Deploys |
|----------|---------|---------|
| `fly.yml` ("Deploy to Fly.io") | `push` to `main`, manual | code changes (PR merges) |
| `update-data.yml` ("Update match data") | cron / manual | data changes — deploys **itself** |

**Why the updater deploys itself instead of relying on its commit:**
A commit pushed by a workflow using the default `GITHUB_TOKEN` **does not trigger
other workflows** — GitHub blocks this to prevent infinite workflow loops. So
`fly.yml`'s `on: push` never fired for the bot's data commits: the new scores were
committed to `main` but the running Fly machine kept serving the stale image. The
symptom was *"the Action says it succeeded but the site doesn't update."*

The fix: `update-data.yml` runs `flyctl deploy --remote-only` in the same job,
gated on whether a commit was actually made (`steps.commit.outputs.committed`).

**Required repo secrets** (Settings → Secrets and variables → Actions):
- `ANTHROPIC_API_KEY` — used by the updater script.
- `FLY_API_TOKEN` — used by **both** workflows to deploy.

---

## 6. Standings & bracket are *derived*, not stored

The browser computes group tables (`computeStandings()` in `index.html`) and the
projected knockout bracket directly from `dayMatches` scores. There is no separate
standings/bracket data to keep in sync — fix the scores and everything downstream
recomputes. This is also why score *accuracy* matters so much: one wrong `FT`
score silently distorts a group table and the bracket.

---

## 7. Correcting data by hand

The updater's source is a web-search agent, which can occasionally return a wrong
score, a placeholder venue (e.g. a literal `"Group C"`), or schedule a fixture on
the wrong day. Because finals are immutable, a bad `FT` score **will not** self-heal
— it must be corrected manually:

1. Edit `data/matches.json` directly (it's the source of truth).
2. Run `npm test` — the smoke test validates JSON, array alignment, the single
   `today` flag, and **no duplicate fixtures**.
3. Commit to `main`. The `fly.yml` deploy fires on your (human) push and ships it.

### Known limitations / watch-list
- **Venues** are display-only and unvalidated; some seed/auto entries are
  placeholders like `"Group C"`. The UI falls back to `"Group <g> · venue TBD"`
  when `venue` is absent.
- **Scores are only as accurate as the web-search agent.** There is no
  authoritative sports-data API cross-check yet — a sensible next step (see
  `HANDOFF.md`).
- The cron only runs while the repo is active (GitHub disables schedules after 60
  days of inactivity — fine for a tournament window).
