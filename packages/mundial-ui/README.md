# @mundial/ui

The **Mundial** design system — the World Cup 2026 tracker's UI extracted as a
reusable React + TypeScript component library. Built with Vite (library mode);
synced to claude.ai/design via `design-sync` so the design agent composes
Mundial's real components.

## Usage

```tsx
import { NavPills, Flag, StatusBadge } from '@mundial/ui';
import '@mundial/ui/styles';

<NavPills
  items={[
    { id: 'globe', label: 'Globe' },
    { id: 'matchday', label: 'Matchday' }
  ]}
  value="globe"
  onChange={setView}
/>
```

## Styling

Components style themselves entirely from the `--mun-*` design tokens in
`src/styles/tokens.css`. Build app layout with those tokens too — never
hard-code colors/radii. The fonts (Inter + Playfair Display) are loaded by the
stylesheet.

## Build

```bash
npm install
npm run build      # → dist/ (ESM bundle + mundial-ui.css + .d.ts)
npm run typecheck
```

## Components

Phase 1 (primitives): `Brand`, `Eyebrow`, `Flag`, `Pill`, `NavPills`,
`StatusBadge`. More (match cards, standings, bracket, globe) land in later
phases.
