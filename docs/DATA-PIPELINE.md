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
│     → provider chain finds WC2026 results (first available source wins):  │
│         1. football-data.org (structured API)        ── PRIMARY           │
│         2. Claude (claude-sonnet-4-6) + web_search   ── FALLBACK           │
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
| `a`, `b`     | FIFA 3-letter team codes. Must be from the fixed `TEAM_CODES` list in `scripts/providers/team-codes.js`. |
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

## 3. The updater — `scripts/update-data.js` + `scripts/providers/`

Run by the GitHub Action (or locally: `npm run update`, needs at least one of
`FOOTBALL_DATA_TOKEN` or `ANTHROPIC_API_KEY`).

### Pluggable data sources (SOLID)

`update-data.js` is a thin **orchestrator**: it depends only on a small
`ResultsProvider` contract, never on a concrete API (Dependency Inversion). Each
provider lives in `scripts/providers/` and exposes three members:

```
{ name, isAvailable(), async fetchUpdate(currentData) → { new_days, updated_matches } | null }
```

Because every provider returns the **same normalized shape** `mergeUpdate()`
already consumes, they're interchangeable (Liskov) and a new source is added
without touching the orchestrator or the merge logic (Open/Closed).

| Provider | File | Role | Notes |
|----------|------|------|-------|
| `football-data.org` | `providers/sports-api.js` | **PRIMARY** | Structured, free, no LLM, no hallucinated scores. Maps fixtures → normalized shape. |
| `claude-web-search` | `providers/claude-search.js` | **FALLBACK** | Claude + `web_search`. Reached only when the primary can't run. |

`providers/runner.js` is a **chain of responsibility**: it tries each available
provider in order. A provider that *runs successfully is authoritative for that
run* — even if it reports "nothing new" — so the billed fallback is **not** called
when the primary is healthy. The fallback is reached only when the primary is
unavailable, errors, or returns `null`. Per-provider errors are isolated and
never rethrown, so one bad source can't fail the run.

Team identifiers from the API are mapped to our 48 FIFA codes in
`providers/team-codes.js`; any fixture whose teams don't **both** resolve is
**dropped with a warning, never guessed** (a wrong code renders a broken flag and
poisons the derived standings/bracket).

**Flow:**
1. `loadCurrentData()` reads the existing `data/matches.json`.
2. `runProviders([sportsApi, claude], current)` returns the first authoritative
   `{ new_days, updated_matches }` (or `{null}` if no source was available).
3. **`mergeUpdate(current, update)`** applies it and returns `{ data, changed }`:
   - **`new_days`** — for each match, skip it if its team-pair already exists
     anywhere (dedup, invariant #2). New fixtures are appended to the matching
     day, or a brand-new day is created. Empty/all-dupe days are dropped.
   - **`updated_matches`** — locate the fixture (order-independent), and patch it
     **only if it isn't already `FT`** (invariant #3) **and** the incoming status
     is `FT`/`LIVE`. Scores are flipped if the source reported the teams in the
     opposite order. A patch that wouldn't change anything is ignored.
   - `changed` is `true` only when match content actually moved.
4. **Save gate:** if `changed` is false, the file is **not** rewritten. This
   matters because `saveData()` bumps `updatedAt` unconditionally — without the
   gate, every run would produce a timestamp-only diff, a commit, and a
   pointless redeploy.

### Resilience
- **Two independent sources.** When the primary (or its credits) is down, the
  fallback carries the run, and vice-versa — freshness no longer hinges on one API.
- The Anthropic SDK is configured with `maxRetries: 5` (honors `retry-after`).
- A persistent `429` (rate limit) **or a `400` "credit balance too low"** is
  swallowed (logged, source skipped) rather than failing the job. Neither should
  turn the Action red or spam notifications — the other source or the next cron
  tick carries on. *(This was a real outage: depleted Anthropic credits threw a
  400 that failed every 30-min run until the chain + graceful-skip landed.)*
- A provider returning `null`/empty, an unreachable API, or no configured source
  all exit **green**.

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
- `FOOTBALL_DATA_TOKEN` — primary data source (free at football-data.org).
- `ANTHROPIC_API_KEY` — fallback data source (web-search). At least one of these
  two must be set; both is recommended for redundancy.
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
- **Source accuracy.** The primary source (football-data.org) is structured and
  authoritative. The Claude web-search fallback can still occasionally return a
  wrong score or misdated fixture, so it only runs when the primary is
  unavailable, and `mergeUpdate`'s immutability/dedup invariants apply to both.
  A future enhancement is to *cross-check* the two sources rather than treat them
  strictly as primary/fallback.
- The cron only runs while the repo is active (GitHub disables schedules after 60
  days of inactivity — fine for a tournament window).
