# mundial.buzz

A live companion to the **FIFA World Cup 2026** (Canada · Mexico · USA,
Jun 11 – Jul 19) — a 3D globe of all 48 nations paired with day-by-day results,
computed group tables, a projected knockout bracket, and a real-time "buzz"
layer showing which countries the world is watching right now.

Everything is one page with five views. The globe stays mounted behind every
view, so moving between them feels continuous.

| | View | What it answers | Docs |
|---|------|-----------------|------|
| 🔥 | **Buzz** | Who's loudest right now? | [buzz.md](docs/features/buzz.md) |
| 🌍 | **Globe** | Where is everyone, and how's the energy? | [globe.md](docs/features/globe.md) |
| 📅 | **Matchday** | What happened / is happening today? | [matchday.md](docs/features/matchday.md) |
| 📊 | **Standings** | Who's advancing? | [standings.md](docs/features/standings.md) |
| 🏆 | **Bracket** | How might the knockouts play out? | [bracket.md](docs/features/bracket.md) |

**Feature tour:** in-app at **`/features`** ([source](public/features/index.html)) ·
[`docs/FEATURES.md`](docs/FEATURES.md) ·
**Operator/dev docs:** [`HANDOFF.md`](HANDOFF.md),
[`docs/DATA-PIPELINE.md`](docs/DATA-PIPELINE.md),
[`docs/X-API-REALTIME.md`](docs/X-API-REALTIME.md)

---

# CODING AGENTS: READ THIS FIRST

This is a **handoff bundle** from Claude Design (claude.ai/design).

A user mocked up designs in HTML/CSS/JS using an AI design tool, then exported this bundle so a coding agent can implement the designs for real.

## What you should do — IMPORTANT

**Read the chat transcripts first.** There are 5 chat transcript(s) in `chats/`. The transcripts show the full back-and-forth between the user and the design assistant — they tell you **what the user actually wants** and **where they landed** after iterating. Don't skip them. The final HTML files are the output, but the chat is where the intent lives.

**Read `project/Match Hero.dc.html` in full.** The user had this file open when they triggered the handoff, so it's almost certainly the primary design they want built. Read it top to bottom — don't skim. Then **follow its imports**: open every file it pulls in (shared components, CSS, scripts) so you understand how the pieces fit together before you start implementing.

**If anything is ambiguous, ask the user to confirm before you start implementing.** It's much cheaper to clarify scope up front than to build the wrong thing.

## About the design files

The design medium is **HTML/CSS/JS** — these are prototypes, not production code. Your job is to **recreate them pixel-perfectly** in whatever technology makes sense for the target codebase (React, Vue, native, whatever fits). Match the visual output; don't copy the prototype's internal structure unless it happens to fit.

**Don't render these files in a browser or take screenshots unless the user asks you to.** Everything you need — dimensions, colors, layout rules — is spelled out in the source. Read the HTML and CSS directly; a screenshot won't tell you anything they don't.

## Bundle contents

- `README.md` — this file
- `chats/` — conversation transcripts (read these!)
- `project/` — the `mundial.buzz` project files (HTML prototypes, assets, components)
