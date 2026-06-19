# design-sync notes

Context the converter/heuristics can't infer, and corrections for future syncs.

## Repo shape
- The design system is **not at repo root** — it lives in the monorepo package
  `packages/mundial-ui/` (the rest of the repo is the deployed tracker app).
- Shape is **storybook**: `packages/mundial-ui/.storybook/` is the config dir
  (recorded in `config.json` as `storybookConfigDir`). The package's own
  `package.json` / lockfile drive the install; run the converter from the
  package.
- Build: `npm install && npm run build` in `packages/mundial-ui` emits the
  library `dist/` (ESM bundle + single `mundial-ui.css` + per-component
  `.d.ts`). `npm run build-storybook` renders the stories for preview capture.

## Running the actual sync
Run `/design-sync` from an environment that has **both**:
1. the `DesignSync` tool available (to create the Claude Design project and
   upload), and
2. a browser for Storybook preview capture (Playwright/Chromium).

Neither was present in the container where this config was authored, so the
config + conventions header were prepared deterministically and committed; the
upload itself is the only remaining step.

## Conventions header
`conventions.md` is human-editable and prepended to the generated README.
Every token/component it names was validated against the built artifacts. If
the component set or token vocabulary changes, re-validate before syncing.
