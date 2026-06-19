# Mundial (mundial-buzz) — Session Handoff

**Last updated:** 2026-06-19
**Repo:** https://github.com/black-flag-collective/mundial-buzz
**Target URL:** https://mundial-buzz.fly.dev (Fly.io)

---

## What this is

A FIFA World Cup 2026 tracker, built from a Claude Design export ("Mundial").
Single-page app in **Design Component (`.dc.html`) format** — a self-contained
React runtime — wrapped in an Express server that keeps match data live via a
Claude web-search agent.

Four views: **Globe** (Three.js 3D explorer of all 48 nations), **Matchday**
(day-by-day results with a timeline slider), **Standings** (computed group
tables), **Bracket** (projected knockout).

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
        └─ commits data/matches.json back to main  ──► persists + triggers deploy

Deploy:  git push main ──► GitHub Actions (.github/workflows/fly.yml)
                            └─ flyctl deploy --remote-only ──► Fly.io
```

## Key files

| File | Role |
|------|------|
| `public/index.html` | The app (modified design export — added `_loadLiveData()` + `dataUpdated` binding) |
| `public/support.js` | DC runtime (loads React 18, parses `<x-dc>` template). Verbatim copy, do not edit. |
| `data/matches.json` | Seed data Jun 11–18. `today` is NOT stored here — server adds it per-request. |
| `server.js` | Express: serves `public/` + `/api/data.json` (injects per-request `today`). No longer runs the updater in-process. |
| `scripts/update-data.js` | Claude web-search updater. Run standalone: `node scripts/update-data.js` |
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
