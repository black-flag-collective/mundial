# Deploy your own mundial.buzz

This guide walks you through running **your own copy** on [Fly.io](https://fly.io),
with **your own** API keys. The public instance at
[mundial-buzz.fly.dev](https://mundial-buzz.fly.dev) is deployed from this repo's
`main`; the steps below are for a fork you control.

> [!IMPORTANT]
> **Bring your own keys.** Every credential below must be one *you* create under
> *your own* accounts. API keys are tied to billing — anyone using a key spends
> the key owner's money and quota. Never paste a key you found in an issue, a
> screenshot, or someone else's repo, and never commit a key to source control
> (`.env` is gitignored; production keys live as Fly/GitHub secrets, never in
> files). See [`.env.example`](.env.example) for the full list of variables.

---

## What you need (all free to start)

| Account | Why | Where |
|---------|-----|-------|
| **Fly.io** | Hosts the web server | [fly.io/app/sign-up](https://fly.io/app/sign-up) + [install flyctl](https://fly.io/docs/flyctl/install/) |
| **GitHub** | Your fork + the deploy/data-update workflows | fork this repo |
| **Anthropic** *(optional)* | Auto-refreshes match scores via Claude web search | [console.anthropic.com](https://console.anthropic.com) → API keys |
| **X / Twitter** *(optional)* | Powers the live "buzz" layer with real post volume | [developer.x.com/en/portal](https://developer.x.com/en/portal) → your App's **Bearer Token** |

The two optional keys are genuinely optional: **without them the site still runs**
— scores stay at whatever is seeded in `data/matches.json`, and the buzz layer
falls back to a built-in simulated signal.

---

## 1. Fork the repo

Fork to your own GitHub account (the **Fork** button, top-right). All commands
below run against *your* fork, not the original.

## 2. Pick your own Fly app name

The name `mundial-buzz` is already taken by the public instance — choose your own
globally-unique name and set it in [`fly.toml`](fly.toml):

```toml
app = "your-unique-app-name"
```

Your site will be served at `https://your-unique-app-name.fly.dev`.

## 3. Create the Fly app

The CI workflow deploys an *existing* app — it doesn't create one. Run once
locally with [flyctl](https://fly.io/docs/flyctl/install/) installed:

```bash
fly auth login
fly apps create your-unique-app-name      # must match fly.toml
```

> The first `fly deploy` can also create the app: run `fly deploy` from the repo
> root once, then let CI handle every push after that.

## 4. Add your secrets

**Two of these go to GitHub** (the deploy + data-update workflows run there), and
**one goes to Fly** (the web server reads it at runtime). Here's where each lives
and why:

### GitHub Actions secrets

In your fork: **Settings → Secrets and variables → Actions → New repository secret**

```bash
fly tokens create deploy -x 999999h    # prints a token starting with FlyV1...
```

| Secret | Required? | Value |
|--------|-----------|-------|
| `FLY_API_TOKEN` | **Yes** | The `FlyV1...` token above. Lets GitHub Actions deploy to *your* Fly app. |
| `ANTHROPIC_API_KEY` | Optional | Your `sk-ant-...` key from [console.anthropic.com](https://console.anthropic.com). Enables the scheduled "Update match data" workflow. Omit it and scores just won't auto-refresh. |

### Fly secret

The live X buzz stream runs inside the web server, so its token is a **Fly**
secret, not a GitHub one:

```bash
fly secrets set X_BEARER_TOKEN=your-own-x-bearer-token
```

Omit this and the buzz layer runs on the simulated signal. Full setup,
cost tiers, and the cheaper "counts" mode are in
[`docs/X-API-REALTIME.md`](docs/X-API-REALTIME.md).

## 5. Deploy

Push to `main` (or use **Actions → Run workflow**) → GitHub Actions runs
`flyctl deploy --remote-only` → live at `https://your-unique-app-name.fly.dev`
in ~1–2 min.

Prefer to deploy by hand without CI? From the repo root:

```bash
fly deploy
```

---

## How live score updates work

- The score updater runs as a **scheduled GitHub Action**
  (`.github/workflows/update-data.yml`, every 30 min), **not** in the web server.
- It runs the Claude agent in `scripts/update-data.js`, which web-searches for the
  latest WC2026 results and patches `data/matches.json`. Merges are additive —
  confirmed `FT` scores are never overwritten.
- The Action commits `matches.json` back to `main` (which persists the data) and
  then redeploys, so your live site picks up fresh scores.
- This is why `ANTHROPIC_API_KEY` is a **GitHub Actions secret** (the Action uses
  it), while `X_BEARER_TOKEN` is a **Fly secret** (the running server uses it).
