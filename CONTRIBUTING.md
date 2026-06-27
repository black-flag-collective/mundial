# Contributing to mundial.buzz

Thanks for your interest in improving mundial.buzz! This is a small project, so
the process is light.

## Getting started

Requires **Node ≥ 20**.

```bash
git clone https://github.com/black-flag-collective/mundial.git
cd mundial-buzz
npm install
npm start          # http://localhost:3000
npm test           # smoke test + X rules self-test
```

No secrets are needed to run or test the app — it serves the seeded data in
[`data/matches.json`](data/matches.json) and a simulated buzz signal. The
optional integrations (live scores, live X buzz) are documented in
[`.env.example`](.env.example) and [`DEPLOY.md`](DEPLOY.md).

## Making changes

1. **Fork** the repo and create a branch off `main`
   (e.g. `feat/globe-labels` or `fix/standings-tiebreak`).
2. Make your change. Keep it focused — one logical change per PR.
3. **Run `npm test`** and make sure it passes. If you touch the data pipeline or
   the buzz engine, add or update an assertion in the relevant script under
   `scripts/`.
4. Open a pull request against `main`. Fill in the PR template and describe what
   changed and why. CI (the smoke test) must pass before merge.

## Style

- Match the style of the file you're editing — no repo-wide reformatting in a
  feature PR.
- Plain modern JavaScript (Node ≥ 20, ES modules / CommonJS as the surrounding
  file uses). No build step for the server or the front end.
- The files under `public/` are a Design Component export on a self-contained
  React runtime (`support.js`); treat `support.js` and vendored bundles as
  read-only unless you're deliberately updating them.

## Reporting bugs & ideas

Open an [issue](https://github.com/black-flag-collective/mundial/issues)
using one of the templates. For anything security-sensitive, see
[SECURITY.md](SECURITY.md) instead of filing a public issue.

By contributing, you agree your contributions are licensed under the
[MIT License](LICENSE).
