# Security Policy

## Reporting a vulnerability

Please **do not** open a public issue for security problems.

Instead, report privately through GitHub's
[private vulnerability reporting](https://github.com/black-flag-collective/mundial/security/advisories/new)
(the **Security → Report a vulnerability** button on the repo). We'll acknowledge
the report and work with you on a fix and disclosure timeline.

## Secrets and API keys

This project uses API keys only for optional integrations, and never stores them
in source:

- `ANTHROPIC_API_KEY` — used by the scheduled data-update GitHub Action
  (a GitHub Actions secret).
- `X_BEARER_TOKEN` — used by the live buzz stream in the running server
  (a Fly secret).
- `FLY_API_TOKEN` — used by the deploy workflows (a GitHub Actions secret).

`.env` is gitignored, and `.env.example` ships only placeholders. **If you fork
or deploy this project, create your own keys under your own accounts** — keys
bill to their owner. If you ever commit a key by mistake, rotate it immediately;
removing it from a later commit is not enough once it has been pushed.

## Data handling

The buzz layer stores only **aggregate intensity per country** — no post text,
authors, or IDs are persisted. See [`docs/X-API-REALTIME.md`](docs/X-API-REALTIME.md).
