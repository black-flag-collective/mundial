// Loads the Mundial UI design system (window.MundialUI) into this page.
// Synced from the claude.ai/design "Mundial UI" project; `base` points at the
// vendored bundle under public/buzz/_ds (served at /buzz/_ds). React itself is
// provided by the DC runtime (support.js exposes window.React), so only the
// component bundle + styles are loaded here.
(() => {
  const base = '_ds';
  for (const p of ['_ds_bundle.css', 'styles.css']) {
    const l = document.createElement('link');
    l.rel = 'stylesheet';
    l.href = base + '/' + p;
    document.head.appendChild(l);
  }
  const s = document.createElement('script');
  s.src = base + '/_ds_bundle.js';
  s.onerror = () => console.error('ds-base.js: failed to load ' + s.src);
  document.head.appendChild(s);
})();
