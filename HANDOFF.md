# Mundial (mundial-buzz) — Session Handoff

**Last updated:** 2026-06-19
**Repo:** https://github.com/black-flag-collective/mundial-buzz
**Target URL:** https://mundial-buzz.fly.dev (Fly.io)

> **Data layer details:** see [`docs/DATA-PIPELINE.md`](docs/DATA-PIPELINE.md) for
> the full schedule/score pipeline, data-accuracy invariants, the deploy
> `GITHUB_TOKEN` gotcha, and how to correct data by hand.

---

## What this is

A FIFA World Cup 2026 tracker, built from a Claude Design export ("Mundial").
Single-page app in **Design Component (`.dc.html`) format** — a self-contained
React runtime — wrapped in an Express server that keeps match data live via a
Claude web-search agent.

Four views: **Globe** (Three.js 3D explorer of all 48 nations), **Matchday**
(day-by-day results with a timeline slider), **Standings** (computed group
tables), **Bracket** (projected knockout).

The Globe and Matchday views also carry a **live "buzz" layer** — a shader
wave-field that ripples across the map to show how loud each country is on
social right now (see the Buzz layer section below).

---

## Current status: ✅ code complete, ✅ pushed to GitHub, ⏳ not yet deployed

The repo is on GitHub. Remaining work is **one-time Fly.io setup** (see below) —
no code changes needed to go live.

---

## Architecture

```
Browser ──GET /──────────► public/index.html + public/support.js  (the app)
        ──GET /api/data.json─► server.js reads data/matches.json,
                               injects dynamic `today` flag, returns JSON
                               └─ app's _loadLiveData() swaps in fresh data

GitHub Action (.github/workflows/update-data.yml, every 30 min + manual)
   └─ scripts/update-data.js  (needs ANTHROPIC_API_KEY repo secret)
        └─ Claude (claude-sonnet-4-6) + web_search_20250305 tool
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

**Source-agnostic by design.** To go from simulated → real X data, feed a real
per-country signal into `tick()` (map rolling tweet counts onto
`state[code].score/.spike`) from the X filtered stream (Pro tier) or
recent-search polling (the 2026 pay-per-use default, ~$0.005/read). The
`/api/buzz.json` contract and the entire globe layer stay identical.

**Privacy:** only aggregate intensity per country is stored — no tweet text,
authors, or ids.

**Known limitation — goal spikes in production.** `fireGoal()` only fires when
the *same* process observes a `matches.json` change. In the commit-Action +
redeploy model the process restarts on every data change, resetting the
in-memory baseline, so real per-goal spikes don't fire in prod. Production
liveness comes from live-match classification + procedural flares. Real per-goal
spikes need a persistent baseline or a delta feed from the updater (see next
steps). The goal-delta path still works in local dev / an in-process updater.

**Tuning knobs** (all in `buildBuzzLayer`, `public/index.html`): wave frequency
`* 34.0`, `reach` radius, ring sharpness `pow(wave, 2.4)`, grid brightness
`0.018 + field*0.62`, and `K` (hottest-country cap). Engine weights live in
`POP` / `MULT` in `scripts/buzz-engine.js`.

**Verified** headless (Playwright + software WebGL) across iterations; `npm test`
covers the endpoint. WebGL1-portability hardened (bounded uniforms, `mediump`
precision fallback, valid `smoothstep` edge order, GPU-resource disposal on
unmount).

---

## TO FINISH DEPLOYMENT (one-time, run locally with flyctl)

```bash
fly auth login
fly apps create mundial-buzz
fly tokens create deploy -x 999999h             # copy the FlyV1... token
```
Then GitHub → Settings → Secrets and variables → Actions, and add:
- `FLY_API_TOKEN`     — the `FlyV1...` token above (deploys).
- `ANTHROPIC_API_KEY` — `sk-ant-...` (enables the scheduled "Update match data"
  workflow that fetches results and commits them back to the repo).

Next push (or Actions → Run workflow) deploys to mundial-buzz.fly.dev.

First deploy can also be done by hand: `fly deploy` from repo root.

---

## Environment notes / gotchas

- **This was a design-export workspace, not repo-connected** — so the original
  container had no GitHub creds and a network policy that blocked Fly's API
  (`api.fly.io` → 403). Code was moved to GitHub via a git bundle.
- **For future sessions: create the Claude Code environment CONNECTED to the
  `mundial-buzz` GitHub repo** so pushes work natively (no tokens/bundles).
  Platform blocks raw PATs as env vars by design.
- Fly deploys run in GitHub Actions (full network), so the container never needs
  to reach Fly directly.
- App still works without `ANTHROPIC_API_KEY` — it just won't auto-refresh scores.
  The key now lives as a **GitHub Actions secret** (used by the updater workflow),
  not as a Fly secret — the server no longer runs the updater in-process.
- **Why the updater moved out of the server:** Fly machines have no persistent
  volume and `min_machines_running = 0`, so the filesystem resets on every
  restart/redeploy (and the in-process timer never ran while auto-stopped). Any
  score written in-process was silently lost. The scheduled Action commits
  `matches.json` to the repo, which persists it and triggers a redeploy.

## Possible next steps (not started)

- First live deploy + smoke-test mundial-buzz.fly.dev.
- Tune updater cadence / prompt once real tournament data flows in.
- Consider a real football API as a fallback/cross-check to the Claude agent.

### Buzz layer — for tomorrow
- **Swap the simulated source for the real X API adapter** (the main goal). Feed
  per-country tweet volume into `tick()` per the "source-agnostic" note above.
  Decide tier first: pay-per-use polling (cheap, near-realtime) vs Pro filtered
  stream (true realtime, $5k/mo). Keep `/api/buzz.json` shape unchanged.
- **Real per-goal spikes in prod** (optional): give the updater a way to emit a
  goal/delta event (or persist `_lastScores` to an external store) so `fireGoal()`
  survives redeploys. Today's prod liveness is live-match flares only.
- **Visual tuning pass** on the wave field once seen on the deployed site with the
  real earth texture (knobs listed in the Buzz layer section).
- Optional `?buzzDemo=1` flag to preview the "loud" state without live data.
