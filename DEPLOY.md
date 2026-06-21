# Deploying Mundial (mundial-buzz) to Fly.io

The app auto-deploys to **https://mundial-buzz.fly.dev** on every push to `main`
via GitHub Actions (`.github/workflows/fly.yml`).

## One-time setup

### 1. Create the Fly app (first time only)

The CI workflow deploys an existing app — it does not create it. Run once from
a machine with [flyctl](https://fly.io/docs/flyctl/install/) installed:

```bash
fly auth login
fly apps create mundial-buzz       # name already set in fly.toml
```

> The first `fly deploy` can also create the app: run `fly deploy` locally once,
> then let CI handle every push after that.

### 2. Add the GitHub Actions secrets

```bash
fly tokens create deploy -x 999999h    # prints a token starting with FlyV1...
```

In GitHub: **Settings → Secrets and variables → Actions → New repository secret**
- `FLY_API_TOKEN` — the `FlyV1...` token from above (used by both the deploy and
  data-update workflows).
- `ANTHROPIC_API_KEY` — `sk-ant-...` (enables the scheduled "Update match data"
  workflow). Optional: without it the site still serves, it just won't
  auto-refresh scores.

### Done

Push to `main` → GitHub Actions runs `flyctl deploy --remote-only` → live in ~1–2 min.
Trigger a manual deploy anytime from the **Actions** tab (`workflow_dispatch`).

## How live updates work

- The score updater runs as a **scheduled GitHub Action**
  (`.github/workflows/update-data.yml`, every 30 min), **not** in the web server.
- It runs the Claude agent in `scripts/update-data.js`, which web-searches for
  the latest WC2026 results and patches `data/matches.json`. Merges are additive
  — confirmed `FT` scores are never overwritten.
- The Action commits `matches.json` back to `main` (which persists the data) and
  then redeploys, so the live site picks up fresh scores.
- `ANTHROPIC_API_KEY` lives as a **GitHub Actions secret**, not a Fly secret.

## Manual deploy (no CI)

```bash
fly deploy
```
