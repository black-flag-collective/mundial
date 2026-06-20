// Preview-only root wrapper for design-sync cards.
//
// Mundial components are white-on-dark — they're designed to sit on the
// `mun-root` dark field (see .design-sync/conventions.md). The preview card
// body is white, so without this wrapper every component renders invisibly
// (white text/marks on white). This establishes the dark field for the card,
// matching how the reference Storybook renders stories on the #04101c canvas
// and how the design agent will compose them inside `mun-root`.
//
// Wired via cfg.extraEntries (merged onto window.<GLOBAL>) + cfg.provider.
import * as React from 'react';

export function MundialRoot({ children }: { children?: React.ReactNode }) {
  return React.createElement(
    'div',
    {
      className: 'mun-root',
      style: {
        background: 'var(--mun-bg)',
        padding: '20px',
        borderRadius: '14px',
        minWidth: 0,
      },
    },
    children,
  );
}
