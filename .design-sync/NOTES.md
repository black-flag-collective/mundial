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

## Sync run findings (2026-06-20, first sync)
- **[GENERAL] CSS sidecar must be pointed at explicitly.** The library ships its
  compiled stylesheet as a *separate* `dist/mundial-ui.css` that the JS bundle
  does not import, so esbuild's `_ds_bundle.css` came up empty and the scrape
  found no CSS (`[CSS_PLACEHOLDER]`/`[CSS_RUNTIME]`). Fix: `cfg.cssEntry =
  "dist/mundial-ui.css"` (package-relative). Without it every card ships
  unstyled.
- **[GENERAL] Components are white-on-dark and need the `mun-root` dark field.**
  The preview card body is white; Mundial components render white text/marks
  (`--mun-fg:#fff`) designed to sit on `mun-root` (`--mun-bg:#04101c`). On the
  white card they render invisibly. The reference Storybook only shows them
  because of its `backgrounds:#04101c` *parameter* (not a decorator, so nothing
  to auto-bundle). Fix: a `MundialRoot` wrapper in
  `.design-sync/preview-root.tsx`, merged onto the global via
  `cfg.extraEntries` and applied via `cfg.provider`. This is also the correct
  presentation for the uploaded cards.
- **GRID_OVERFLOW (wide):** `FeaturedMatch`, `MatchCard`, `Eyebrow` render wider
  than a grid cell → `cfg.overrides.<Name>.cardMode = "column"`.
- **`[FONT_REMOTE]` is expected, not a miss.** `mundial-ui.css` loads Inter +
  Playfair Display via a `@import` from `fonts.googleapis.com` at runtime — no
  `@font-face` ships in the bundle. Don't chase `[FONT_MISSING]`; it doesn't
  fire here.

## Re-sync risks (watch-list for the next sync)
- **`MundialRoot` provider is a sync-only shim**, defined in
  `.design-sync/preview-root.tsx` and wired via `cfg.extraEntries` +
  `cfg.provider`. It is NOT a real `@mundial/ui` export. If the library ever
  ships its own root/provider component, switch `cfg.provider` to that and drop
  the shim. If a future build errors on the `extraEntries` path, confirm it's
  still `../../.design-sync/preview-root.tsx` (package-relative to
  `packages/mundial-ui`, workspace-bounded).
- **`[REFERENCE_STALE?]` is expected on a config-only re-sync.** `cssEntry`,
  `provider`, and `extraEntries` change the *bundle/previews* but not the DS
  *source*, so the reference Storybook stays valid and need NOT be rebuilt.
  Only rebuild `.design-sync/sb-reference` when `packages/mundial-ui/src`
  changes.
- **CDN dependencies at capture time.** Previews load remote assets: the Globe's
  earth texture (`unpkg.com/three-globe/.../earth-blue-marble.jpg`), flag images
  (flagcdn), and the Google Fonts `@import`. A network-sandboxed shell will blank
  these on both panels (`[ASSETS_BLOCKED]`) and grades can falsely pass — run
  capture from a shell with egress. This sync verified the textured Globe and
  flags rendered on both sides.
- **Grades are framing-tolerant by design.** All 17 graded `match` even though
  preview cards frame components in a full-width dark `mun-root` panel while the
  reference Storybook centers them on a full dark canvas. That framing delta is
  intentional (rubric: judge the component, not its surroundings) — don't
  re-grade it as drift.
- **[CRITICAL] The repo lives in `~/Documents`, which is iCloud-synced — build
  `ds-bundle/` to a NON-synced `--out`, never the repo root.** On the 2026-06-21
  re-sync, the converter wrote all 17 components correctly and validate passed,
  then iCloud mangled the on-disk tree seconds later: it spawned a `globe 2/`
  conflict-copy dir (mode `700`) and dropped `bracket/*` + 3 primitives — an
  incomplete tree that would silently desync the project if uploaded. Fix that
  worked: rebuild via `package-build.mjs --out <scratchpad>/ds-bundle` under
  `/private/tmp` (outside iCloud), validate THERE, and `finalize_plan`'s
  `localDir` = that scratchpad path. The driver's own `--out ./ds-bundle` is
  fine for the verdict/diff (read immediately), but never upload from it.
- **Re-sync 2026-06-21 outcome.** Sources unchanged — all 17 `verified-by-upload`
  (0 changed/new/removed). One `canary: reference_drift` (converter/Storybook
  version bump since the first sync re-rendered the reference) spot-checked 5
  (Eyebrow, FeaturedMatch, Pill, ChampionCard, Flag) with grades kept; all 5
  sheets re-confirmed `match`. `conventions.md` re-validated against the fresh
  build — every token/component/font it names still resolves, IBM Plex present,
  no stale Inter/Playfair — left unchanged.
