# Deploying Mundial (mundial-buzz) to Fly.io

The app auto-deploys to **https://mundial-buzz.fly.dev** on every push to `main`
via GitHub Actions (`.github/workflows/fly.yml`).

## One-time setup

### 1. Push this repo to GitHub

This workspace has no git remote yet. Create a repo and push:

```bash
git remote add origin git@github.com:<you>/mundial-buzz.git
git push -u origin main
```

### 2. Create the Fly app (first time only)

The CI workflow deploys an existing app — it does not create it. Run once from
a machine with [flyctl](https://fly.io/docs/flyctl/install/) installed:

```bash
fly auth login
fly apps create mundial-buzz       # name already set in fly.toml
fly secrets set ANTHROPIC_API_KEY=sk-ant-...   # enables live score updates
```

> The first `fly deploy` can also create the app: run `fly deploy` locally once,
> then let CI handle every push after that.

### 3. Add the deploy token to GitHub

```bash
fly tokens create deploy -x 999999h    # prints a token starting with FlyV1...
```

In GitHub: **Settings → Secrets and variables → Actions → New repository secret**
- Name: `FLY_API_TOKEN`
- Value: the token from above

### Done

Push to `main` → GitHub Actions runs `flyctl deploy --remote-only` → live in ~1–2 min.
Trigger a manual deploy anytime from the **Actions** tab (`workflow_dispatch`).

## How live updates work

- `ANTHROPIC_API_KEY` is a **Fly secret** (set in step 2), not a GitHub secret.
- On startup and every 30 min, `server.js` runs the Claude agent in
  `scripts/update-data.js`, which web-searches for the latest WC2026 results and
  patches `data/matches.json`. Merges are additive — confirmed `FT` scores are
  never overwritten.
- Without the key the site still serves; it just won't auto-refresh scores.

## Manual deploy (no CI)

```bash
fly deploy
```
