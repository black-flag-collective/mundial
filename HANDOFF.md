# Mundial (mundial-buzz) — Architecture & Operations

**Repo:** https://github.com/black-flag-collective/mundial-buzz
**Live:** https://mundial-buzz.fly.dev (Fly.io)

> **User-facing feature tour:** see [`docs/FEATURES.md`](docs/FEATURES.md) for
> what each of the five views does and how the Buzz layer ties to the globe.
>
> **Data layer details:** see [`docs/DATA-PIPELINE.md`](docs/DATA-PIPELINE.md) for
> the full schedule/score pipeline, data-accuracy invariants, the deploy
> `GITHUB_TOKEN` gotcha, and how to correct data by hand.

---

## What this is

A FIFA World Cup 2026 tracker. Single-page app in **Design Component
(`.dc.html`) format** — a self-contained React runtime — wrapped in an Express
server that keeps match data live via a Claude web-search agent.

Four views: **Globe** (Three.js 3D explorer of all 48 nations), **Matchday**
(day-by-day results with a timeline slider), **Standings** (computed group
tables), **Bracket** (projected knockout).

The Globe and Matchday views also carry a **live "buzz" layer** — a shader
wave-field that ripples across the map to show how loud each country is on
social right now (see the Buzz layer section below).

---

## Architecture

```
Browser ──GET /──────────► public/index.html + public/support.js  (the app)
        ──GET /api/data.json─► server.js reads data/matches.json,
                               injects dynamic `today` flag, returns JSON
                               └─ app's _loadLiveData() swaps in fresh data

GitHub Action (.github/workflows/update-data.yml, every 30 min + manual)
   └─ scripts/update-data.js  (needs FOOTBALL_DATA_TOKEN and/or ANTHROPIC_API_KEY)
        └─ provider chain (scripts/providers/): first available source wins
             ├─ PRIMARY  football-data.org (structured API, no LLM)
             └─ FALLBACK Claude (claude-sonnet-4-6) + web_search_20250305 tool
             └─ finds latest WC2026 results, mergeUpdate() patches
                data/matches.json  (ADDITIVE ONLY — never overwrites FT scores)
        └─ commits data/matches.json back to main  ──► persists the data
        └─ flyctl deploy --remote-only (same job, only when data changed) ──► Fly.io

Deploy (code changes):  git push main ──► GitHub Actions (.github/workflows/fly.yml)
                            └─ flyctl deploy --remote-only ──► Fly.io

NOTE: the updater deploys itself rather than relying on its commit to trigger
fly.yml. A push made with the default GITHUB_TOKEN does NOT trigger other
workflows (GitHub blocks recursive runs), so fly.yml's `on: push` never fired
for bot data commits — the data persisted but the site never redeployed. Both
the updater workflow and fly.yml need the FLY_API_TOKEN repo secret.
```

## Key files

| File | Role |
|------|------|
| `public/index.html` | The app (modified design export — added `_loadLiveData()` + `dataUpdated` binding) |
| `public/support.js` | DC runtime (loads React 18, parses `<x-dc>` template). Verbatim copy, do not edit. |
| `data/matches.json` | Seed data Jun 11–18. `today` is NOT stored here — server adds it per-request. |
| `server.js` | Express: serves `public/` + `/api/data.json` (injects per-request `today`) + `/api/buzz.json` (buzz snapshot). Starts the buzz engine on boot. No longer runs the data updater in-process. |
| `scripts/update-data.js` | Claude web-search updater. Run standalone: `node scripts/update-data.js` |
| `scripts/buzz-engine.js` | Buzz engine (simulated source). Per-country `score`/`spike` from popularity + live-match state + procedural flares. Source-agnostic — swap in a real X adapter later. |
| `scripts/smoke-test.js` | `npm test` — boots the server and asserts `/`, `/support.js`, `/api/data.json`, `/api/buzz.json` serve correctly. |
| `.github/workflows/update-data.yml` | Scheduled (every 30 min) updater: runs the script and commits `matches.json` back to main. Needs `ANTHROPIC_API_KEY` repo secret. |
| `Dockerfile` | Node 20 Alpine |
| `fly.toml` | app=`mundial-buzz`, region=iad, 256MB, auto-stop when idle |
| `.github/workflows/fly.yml` | Auto-deploy on push to main + manual dispatch |
| `DEPLOY.md` | Full deploy instructions |
| `project/Match Hero.dc.html` | READ-ONLY source of truth for the original design |
| `project/support.js` | READ-ONLY original runtime |

## Data model

`data/matches.json`:
```json
{
  "updatedAt": "ISO timestamp",
  "days": [{ "dow": "Thursday", "short": "Jun 11", "long": "June 11" }],
  "dayMatches": [
    [{ "g": "A", "a": "MEX", "b": "RSA", "as": 2, "bs": 0, "st": "FT", "venue": "..." }]
  ]
}
```
- `days[i]` aligns with `dayMatches[i]`.
- `st`: `"FT"` (final), `"UP"` (upcoming, has `time` instead of scores), `"LIVE"`.
- Team codes are fixed FIFA 3-letter strings (see `TEAM_CODES` in update-data.js).
- **Safety invariant:** `mergeUpdate()` only appends new days and only patches
  matches where `st !== 'FT'`. Confirmed finals are immutable.

---

## Buzz layer (live social pulse)  — shipped in PR #7

A globe overlay that visualizes how much each country is being talked about,
as a wave field rippling across the map surface (confederation-colored), with a
faint lat/lon grid that brightens where buzz concentrates. Reads on the **Globe**
and **Matchday** views.

```
scripts/buzz-engine.js ──► server.js  GET /api/buzz.json
   per-country score+spike            { updatedAt, window, source,
   (rolling, in-memory)                 buzz: [{ code, score, spike, rank }] }
        ▲                                        │  poll every 4s
   simulated source                              ▼
   (popularity + live-match              public/index.html
    state + procedural flares)           _loadBuzz → buzzByCode → updateBuzz
                                         → ShaderMaterial shell over the globe
```

**Data flow:** `_loadBuzz()` polls `/api/buzz.json` every 4s into `buzzByCode`;
`updateBuzz()` eases displayed values each frame and uploads only the **K=24
hottest** countries into the shader uniforms (`buildBuzzLayer` in
`public/index.html`).

**Engine model (`scripts/buzz-engine.js`):** each country's `score` (sustained
glow) eases toward `popularity × match-state multiplier × procedural noise`;
`spike` (sharp pulse) is added by live-match flares and by `fireGoal()` on a
detected score change, then decays.

**Real X data: the counts adapter (shipped).** The cost-bounded counts poller
([`scripts/buzz-counts.js`](scripts/buzz-counts.js), `X_BUZZ_MODE=counts`) is the
production adapter. It polls `GET /2/tweets/counts/recent` per team (volume only,
no post bodies), feeds sustained volume into `engine.setSignals()` (the glow
floor) and minute-over-minute jumps into `engine.surge()` (the spike). Polling is
scoped to live match windows via each fixture's `ko` kickoff time, so it spends
nothing when no match is live. Full design + cost envelope in
[`docs/X-API-REALTIME.md`](docs/X-API-REALTIME.md). The `/api/buzz.json` contract
and the globe layer stay identical — the engine is still source-agnostic.

**Privacy:** only aggregate intensity per country is stored — no tweet text,
authors, or ids.

**Goal spikes in production — covered by counts momentum.** The in-process
`fireGoal()` path (comparing `matches.json` reads) only works in local dev / an
in-process updater: in prod the process restarts on every data commit, resetting
the baseline. In counts mode this no longer matters — goal-reaction pops come
from the **counts trend** (a sharp minute-over-minute volume jump fires
`engine.surge()`), which is independent of the in-process delta and survives
redeploys. Without a token, prod liveness still falls back to live-match
classification + procedural flares.

**Tuning knobs** (all in `buildBuzzLayer`, `public/index.html`): wave frequency
`* 34.0`, `reach` radius, ring sharpness `pow(wave, 2.4)`, grid brightness
`0.018 + field*0.62`, and `K` (hottest-country cap). Engine weights live in
`POP` / `MULT` in `scripts/buzz-engine.js`.

**Verified** headless (Playwright + software WebGL) across iterations; `npm test`
covers the endpoint. WebGL1-portability hardened (bounded uniforms, `mediump`
precision fallback, valid `smoothstep` edge order, GPU-resource disposal on
unmount).

---

## Buzz Oracle (on-demand AI prediction)

A shareable, data-grounded tournament prediction generated by a deliberately
cheap, **on-demand** AI call ([`scripts/predict.js`](scripts/predict.js),
`GET /api/predict`). It reads the signals the app already has — live buzz, X
trends, results so far ([`buildContext()`](scripts/predict.js)) — and returns a
measured pick `{ champion, finalScore, hotTake, evidence }`.

```
user taps "Ask the Oracle" → GET /api/predict
  → buildContext(matches + buzz + trends)  (compact, ~few hundred tokens)
  → cache hit (signature + TTL)? serve it free
  → else claude-haiku-4-5, max_tokens ~320, system prompt cache_control
```

**Cost is bounded by design** (it's the expensive path, so it's the most
guarded): cheapest model; a server-side cache keyed by a coarse buzz signature
so thousands of viewers within the TTL share **one** call; a per-client
min-interval; and a hard daily-call cap (circuit breaker). Worst case is a few
hundred Haiku calls/day → cents. Wired only when `ANTHROPIC_API_KEY` is set
(a Fly secret); otherwise `/api/predict` returns `{ available: false }` and the
UI hides the button. Tunables: `X_PREDICT_*` (see [`.env.example`](.env.example)).

---

## Deployment

Full instructions are in [`DEPLOY.md`](DEPLOY.md). One-time Fly.io setup, run
locally with [flyctl](https://fly.io/docs/flyctl/install/):

```bash
fly auth login
fly apps create mundial-buzz
fly tokens create deploy -x 999999h             # copy the FlyV1... token
```
Then GitHub → Settings → Secrets and variables → Actions, and add:
- `FLY_API_TOKEN`     — the `FlyV1...` token above (deploys).
- `ANTHROPIC_API_KEY` — `sk-ant-...` (enables the scheduled "Update match data"
  workflow that fetches results and commits them back to the repo).

After that, every push to `main` (or **Actions → Run workflow**) deploys to
mundial-buzz.fly.dev. A first deploy can also be done by hand with `fly deploy`.

---

## Operational notes

- Fly deploys run in GitHub Actions (full network), so the container never needs
  to reach Fly directly.
- The updater needs at least one data source — `FOOTBALL_DATA_TOKEN` (primary)
  and/or `ANTHROPIC_API_KEY` (fallback) — as **GitHub Actions secrets**. With
  neither, the site still serves the last committed data; it just won't
  auto-refresh. The keys are not Fly secrets — the server no longer runs the
  updater in-process.
- **Why the updater moved out of the server:** Fly machines have no persistent
  volume and `min_machines_running = 0`, so the filesystem resets on every
  restart/redeploy (and the in-process timer never ran while auto-stopped). Any
  score written in-process was silently lost. The scheduled Action commits
  `matches.json` to the repo, which persists it and triggers a redeploy.

## Roadmap

- Tune updater cadence / prompt once real tournament data flows in.
- A real football API (football-data.org) is now the **primary** source with
  Claude as fallback (`scripts/providers/`). Next: cross-check the two sources
  against each other rather than strict primary/fallback, and refine the
  team-code alias table in `providers/team-codes.js` as real API data arrives.

### Buzz layer
- **Front-end "your country is trending".** The API now returns per-nation
  `trend` and a `phase` flag (`live`/`cooldown`/`idle`); the globe + `/buzz`
  leaderboard could surface a rising/falling indicator and auto-highlight the
  visitor's country (from locale/timezone) to make "watch your country light up"
  explicit. (Backend shipped; UI not yet wired.)
- **Visual tuning pass** on the wave field once seen on the deployed site with the
  real earth texture (knobs listed in the Buzz layer section).
- Optional `?buzzDemo=1` flag to preview the "loud" state without live data.
- _Done:_ real X data via the cost-bounded counts adapter + goal-reaction
  momentum surges (see the Buzz layer section above).
