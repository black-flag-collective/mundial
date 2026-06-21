# Features

User-facing docs for each of mundial.buzz's five views. For the full tour in one
page, see [`docs/FEATURES.md`](../FEATURES.md).

| | View | What it answers |
|---|------|-----------------|
| 🔥 | [Buzz](buzz.md) | Who's loudest right now? |
| 🌍 | [Globe](globe.md) | Where is everyone, and how's the energy? |
| 📅 | [Matchday](matchday.md) | What happened / is happening today? |
| 📊 | [Standings](standings.md) | Who's advancing? |
| 🏆 | [Bracket](bracket.md) | How might the knockouts play out? |

The five views share one page; the globe stays mounted behind every view, so
moving between them feels continuous. The nav pill order is **Buzz · Globe ·
Matchday · Standings · Bracket**.

---

## Maintaining these docs (for future agents)

These are **user-facing** descriptions of behavior, kept in sync by hand with
the app. There is no generator — when you change a feature, update the prose.

**Source of truth → doc map:**

| Where the behavior lives | Doc(s) to update |
|--------------------------|------------------|
| `public/index.html` — view markup (`isBuzz`/`isGlobe`/`isMatchday`/`isStandings`/`isBracket` blocks) and `class Component` logic | the matching `docs/features/<view>.md` |
| Buzz ↔ Globe wiring — `_loadBuzz`, the cycling chip (`buzzChipIdx`), surge toast (`surgeToast`), click-through focus (`buzzFocusCode`) | [`buzz.md`](buzz.md) + [`globe.md`](globe.md) |
| Buzz feed / X integration — `scripts/buzz-engine.js`, `scripts/x-*.js`, `server.js` `/api/buzz.json` | [`buzz.md`](buzz.md) "How it stays live" + [`../X-API-REALTIME.md`](../X-API-REALTIME.md) |
| Match data / scores / standings / bracket derivation — `data/matches.json`, `scripts/update-data.js`, `server.js` `/api/data.json` | [`matchday.md`](matchday.md), [`standings.md`](standings.md), [`bracket.md`](bracket.md) + [`../DATA-PIPELINE.md`](../DATA-PIPELINE.md) |

**When you touch a feature, also update — so they don't drift:**

1. The per-feature doc in this folder (`docs/features/<view>.md`).
2. The one-page tour [`../FEATURES.md`](../FEATURES.md) (the quick-reference
   table at its bottom is the fastest thing to check).
3. The five-view table in the repo-root [`../../README.md`](../../README.md).
4. The in-app visual page at [`public/features/index.html`](../../public/features/index.html)
   (served at **`/features`**) mirrors `FEATURES.md`. It's a hand-maintained,
   self-contained HTML page — if you reshape the tour, update it too. Keep it
   self-contained (inline CSS, no external fonts/scripts) so it deploys as a
   plain static file.

**Keep it user-facing.** Describe what a visitor sees and does, not how the code
is structured. Implementation detail belongs in `HANDOFF.md` /
`DATA-PIPELINE.md` / `X-API-REALTIME.md`, which these docs link to rather than
duplicate.

**Last reconciled:** these docs match `main` as of the cross-view **surge
toast** + idle buzz orbit + globe→board click-through work (merged in PR #34,
commit `065a8a2`). When you ship the next feature, work down the four-step
checklist above so the docs don't fall behind.
