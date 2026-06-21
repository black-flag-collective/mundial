# Mundial design system — how to build with it

Mundial is a dark-field World Cup UI. Components are **prop-driven and
self-styling** — you compose them and pass data; you do **not** restyle them
with utility classes. All color/space/type comes from CSS custom-property
**tokens**, so build your own layout glue with those same tokens.

## Setup

1. Load the stylesheet once: `import '@mundial/ui/styles';` (it brings the
   tokens and the IBM Plex Sans + IBM Plex Serif fonts). Nothing renders
   correctly styled without it.
2. Wrap the app (or any Mundial surface) in an element with the **`mun-root`**
   class — it sets the dark background (`--mun-bg`), the IBM Plex Sans font, and
   the base text color. Components are designed to sit on that dark field.
3. `<Globe>` renders into its parent box — give it a **sized container**
   (e.g. `width/height: 100%` of a positioned parent); it has no intrinsic size.

## Styling idiom — tokens, not classes

Style with `var(--mun-*)`. Never hard-code hex/px that a token covers, and
don't invent class names — components own their classes.

- **Background / accent:** `--mun-bg` (#04101c), `--mun-accent` (the orange),
  `--mun-accent-hover`, `--mun-accent-soft`, `--mun-blue`.
- **Text on dark:** `--mun-fg`, `--mun-fg-display` (oversized headings),
  `--mun-fg-muted`, `--mun-fg-subtle`, `--mun-fg-faint`.
- **Glass surfaces:** `--mun-surface-1` … `--mun-surface-4`, `--mun-surface-nav`,
  `--mun-surface-active`; hairlines `--mun-border`, `--mun-border-strong`.
- **Radii:** `--mun-radius-pill`, `--mun-radius-lg`, `--mun-radius-md`,
  `--mun-radius-sm`. **Type:** `--mun-font-sans`, `--mun-font-display`
  (IBM Plex Serif, used italic for display headings).
- **Confederations:** `--mun-confed-uefa | -conmebol | -caf | -concacaf | -afc | -ofc`.

## Where the truth lives

Read the design system's `styles.css` (it `@import`s `tokens.css`) for the full
token list before styling, and each component's `.prompt.md` / `.d.ts` for its
exact props.

## Components

Primitives: `Brand`, `Eyebrow`, `Flag`, `Pill`, `NavPills`, `StatusBadge`.
Matchday: `MatchCard`, `FeaturedMatch`, `DayTimeline`. Standings:
`StandingsTable`. Bracket: `BracketMatch`, `BracketColumn`, `ChampionCard`.
Globe: `Globe` plus the `ConfederationLegend`, `CountryHero`, `FixtureList`
panels. The `TEAMS` / `CONFEDERATIONS` data and `flagUrl()` helper are exported
for sample/real data.

## One idiomatic example

```tsx
import { NavPills, FeaturedMatch } from '@mundial/ui';
import '@mundial/ui/styles';

<div className="mun-root" style={{ minHeight: '100vh', padding: 'var(--mun-radius-lg)' }}>
  <NavPills
    items={[{ id: 'matchday', label: 'Matchday' }, { id: 'globe', label: 'Globe' }]}
    value="matchday"
    onChange={setView}
  />
  <FeaturedMatch
    group="I" state="final" score="3 – 1" status="Full Time"
    venue="MetLife Stadium, NJ"
    teamA={{ code: 'FRA', name: 'France' }}
    teamB={{ code: 'SEN', name: 'Senegal' }}
  />
</div>
```
