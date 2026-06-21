// Loads the Mundial design system (window.MundialUI + tokens/fonts) for the app.
// Single shared source at /_ds (also used by /buzz). Kept in sync with the
// claude.ai/design "Mundial UI" project via design-sync. React is provided by
// the DC runtime (support.js).
(() => {
  const base = '_ds';
  for (const p of ['_ds_bundle.css', 'styles.css']) {
    const l = document.createElement('link');
    l.rel = 'stylesheet'; l.href = base + '/' + p;
    document.head.appendChild(l);
  }
  const s = document.createElement('script');
  s.src = base + '/_ds_bundle.js';
  s.onerror = () => console.error('ds-base.js: failed to load ' + s.src);
  document.head.appendChild(s);
})();
