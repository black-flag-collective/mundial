# mundial.buzz

[![CI](https://github.com/black-flag-collective/mundial-buzz/actions/workflows/ci.yml/badge.svg)](https://github.com/black-flag-collective/mundial-buzz/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Node ≥ 20](https://img.shields.io/badge/node-%E2%89%A520-43853d.svg)](https://nodejs.org)

A live companion to the **FIFA World Cup 2026** (Canada · Mexico · USA,
Jun 11 – Jul 19) — a 3D globe of all 48 nations paired with day-by-day results,
computed group tables, a projected knockout bracket, and a real-time "buzz"
layer showing which countries the world is watching right now.

**Live:** [mundial-buzz.fly.dev](https://mundial-buzz.fly.dev)

![mundial.buzz — a 3D globe of all 48 World Cup 2026 nations](public/og-image.png)

Everything is one page with five views. The globe stays mounted behind every
view, so moving between them feels continuous.

| | View | What it answers | Docs |
|---|------|-----------------|------|
| 🔥 | **Buzz** | Who's loudest right now? | [buzz.md](docs/features/buzz.md) |
| 🌍 | **Globe** | Where is everyone, and how's the energy? | [globe.md](docs/features/globe.md) |
| 📅 | **Matchday** | What happened / is happening today? | [matchday.md](docs/features/matchday.md) |
| 📊 | **Standings** | Who's advancing? | [standings.md](docs/features/standings.md) |
| 🏆 | **Bracket** | How might the knockouts play out? | [bracket.md](docs/features/bracket.md) |

**Feature tour:** in-app at **`/features`** ([source](public/features/index.html)) ·
[`docs/FEATURES.md`](docs/FEATURES.md)

---

## Running locally

Requires **Node ≥ 20**.

```bash
npm install
npm start          # serves http://localhost:3000
```

That's it — the web server has no required secrets and serves the seeded match
data in [`data/matches.json`](data/matches.json) out of the box.

| Command | What it does |
|---------|--------------|
| `npm start` | Run the Express server (`server.js`) |
| `npm test` | Boot the server and smoke-test the routes + X rules self-test |
| `npm run update` | Run the match-data updater by hand (needs `ANTHROPIC_API_KEY`) |

Optional environment variables are documented in
[`.env.example`](.env.example). None are needed to run the app — they only
enable the live data updater (`ANTHROPIC_API_KEY`) and the real-time X buzz
stream (`X_BEARER_TOKEN`); without them the app falls back to seeded data and a
simulated buzz signal.

## How it works

- **Frontend** — a single-page app in [`public/`](public/): a Three.js globe
  plus the five views, with a WebGL shader "buzz" layer rippling over the map.
- **Server** — [`server.js`](server.js) (Express) serves the app and exposes
  `/api/data.json` (matches, with a per-request `today` flag) and
  `/api/buzz.json` (the live buzz snapshot).
- **Data pipeline** — a scheduled GitHub Action runs
  [`scripts/update-data.js`](scripts/update-data.js), which uses Claude with web
  search to find the latest results and commits them back to
  `data/matches.json` (additively — confirmed final scores are never
  overwritten). See [`docs/DATA-PIPELINE.md`](docs/DATA-PIPELINE.md).
- **Buzz** — [`scripts/buzz-engine.js`](scripts/buzz-engine.js) produces a
  per-country intensity signal (from a simulated source by default, or the live
  X API when configured). See [`docs/X-API-REALTIME.md`](docs/X-API-REALTIME.md).

Architecture, the data model, and operational notes live in
[`HANDOFF.md`](HANDOFF.md).

## Deploy your own

Want to run your own copy on [Fly.io](https://fly.io)? Fork the repo, pick your
own Fly app name, and **bring your own API keys** — see
**[DEPLOY.md](DEPLOY.md)** for the full walkthrough.

The web server needs no keys to run. The two optional integrations each use a key
you create under your own account (and which bills to you, so never reuse anyone
else's):

- **Live score updates** — your own [Anthropic](https://console.anthropic.com)
  `ANTHROPIC_API_KEY` (a GitHub Actions secret).
- **Live X buzz** — your own [X](https://developer.x.com/en/portal)
  `X_BEARER_TOKEN` (a Fly secret).

## Project structure

```
public/        the single-page app (globe, views, buzz shader)
server.js      Express server + JSON APIs
scripts/       data updater, buzz engine, X stream adapter, tests
data/          seeded match data (matches.json)
docs/          feature tour + data/realtime pipeline docs
packages/      mundial-ui design-system package
project/        original HTML/CSS/JS design prototypes (kept for reference)
chats/          design-iteration transcripts (kept for reference)
```

## Contributing

Contributions are welcome — see [CONTRIBUTING.md](CONTRIBUTING.md) for setup and
the PR flow, and [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md). For security issues,
please follow [SECURITY.md](SECURITY.md) rather than opening a public issue.

## License

[MIT](LICENSE) © Black Flag Collective

