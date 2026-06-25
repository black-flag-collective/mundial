# mundial.buzz — Feature Guide

A live companion to the **FIFA World Cup 2026** (Canada · Mexico · USA, Jun 11 – Jul 19).
It pairs a 3D globe of all 48 nations with day-by-day results, computed group
tables, a projected knockout bracket, and a real-time "buzz" layer that shows
which countries the world is talking about right now.

Everything lives on a single page. You move between five views from the pill
nav at the top: **Buzz · Globe · Matchday · Standings · Bracket**. The globe
stays mounted behind every view, so transitions feel continuous rather than
like separate pages.

> A visual version of this tour ships in the app at **`/features`**
> ([`public/features/index.html`](../public/features/index.html)).
>
> Developer/operator docs: [`HANDOFF.md`](../HANDOFF.md),
> [`DATA-PIPELINE.md`](DATA-PIPELINE.md), [`X-API-REALTIME.md`](X-API-REALTIME.md).
> This file is the **user-facing** tour of what each view does.

---

## The five views

### 🔥 Buzz — "Who the world is watching"

The default landing point for live attention. A leaderboard of the nations
generating the most chatter right now, ranked by a **buzz score**.

- **Live count + timestamp** — "_N nations buzzing · updated …_" at the top of
  the board, refreshed every few seconds.
- **Each row** shows rank, flag, FIFA code, country name, a score bar
  (intensity relative to the loudest nation), and the numeric score.
- **SURGING badge (▲)** — appears on a nation whose chatter just spiked sharply
  (a goal, a result, a viral moment). It's the "something is happening _now_"
  signal, distinct from a steadily high score.
- **🔥 Trending strip + badge** — when the live X feed is on, a strip of the
  hottest **World-Cup trends on X** (worldwide + host nations, with post counts)
  sits above the board, and any nation currently trending gets a 🔥 TRENDING
  badge — *what's being said*, on top of *how loud*.
- **Tap any row** to open the **inspect panel** ("what we're pulling from X"):
  the recent-counts query, post volume + a per-minute sparkline, peak/now rate,
  the live-match head-to-head split, the nation's own trending topics, or — for
  a nation not in a live match — when its match is and that its bar is ambient
  interest.
- **🔮 Ask the Oracle** — a button (when the prediction feature is enabled)
  asks an AI for a **data-grounded tournament prediction**: projected champion +
  final, a one-line take, and the buzz/form evidence, with one-tap **share**.
- **States you may see:** a spinner ("_Tuning into the chatter…_") on first
  load, an "_All quiet… for now_" empty state before posts start flowing, and a
  "_Lost the signal_" error with a **Try again** button if the feed can't be
  reached.

> **What "buzz" actually measures** — real X volume for nations in a live match
> vs a modeled attention estimate otherwise — and **how the Oracle uses it** is
> defined in [METHODOLOGY.md](METHODOLOGY.md).

### 🌍 Globe — 48 nations in 3D

An interactive Three.js globe of Earth with every qualified nation marked.

- **Drag to spin**, and it keeps a gentle idle rotation when you're not
  touching it.
- **Hover (or tap) any nation** to spotlight it: its name, flag, and big FIFA
  code appear, along with its **group**, **confederation**, and — if it's
  active — its **live buzz rank and score**. A fixtures panel traces that
  team's road through the group stage.
- **Confederation legend** (bottom-left) colour-codes nations by confederation.
- **The live buzz layer** ripples across the globe's surface as a
  confederation-coloured wave field — brighter and busier where buzz
  concentrates. The pulses you see _are_ the live buzz; the globe and the Buzz
  board are two views of the same signal.
- **"Buzzing now" chip** (bottom-center) names the current leader and cycles
  through the top few nations every few seconds. Click it to open the full Buzz
  board.

### 📅 Matchday — day-by-day results

A timeline of the tournament, one day at a time.

- **Date slider** along the bottom scrubs through every matchday. The day
  marked **TODAY** is highlighted automatically based on the current date.
- **Featured match** sits center-stage for the selected day, with score/status
  (Final, Live, or kickoff time) and venue.
- **Fixtures slate** (right) lists every match that day; click one to feature
  it. Hovering a match traces the two nations on the globe behind.
- Scores here are live — they update as the data pipeline ingests results
  (see [Staying live](#how-the-site-stays-live)).

### 📊 Standings — computed group tables

Live tables for all **12 groups**, derived directly from the match results
(not hand-entered).

- Each table shows the standard table columns and marks the teams currently
  **advancing to the Round of 32** (top two per group).
- **Hover a team** to trace it on the globe below.
- A timestamp shows when the underlying data was last updated.

### 🏆 Bracket — projected knockout

A full projected knockout bracket, **Round of 32 → Final**, laid out left and
right toward a center Champion card.

- Seeded from group favourites; later winners are **projected by world
  ranking** until real results replace them.
- **Hover any matchup** to highlight those nations on the globe.
- Knockout dates: **Jun 28 – Jul 19**.

---

## How Buzz and the Globe connect

The buzz layer isn't a separate gimmick — it's wired into the globe both ways:

- **Globe → Board:** the wave-field pulses, the spotlight's "Buzz rank · score"
  readout, and the cycling **"Buzzing now"** chip all surface the same live
  signal. Click the chip (or a buzzing nation) to open the board.
- **Board → Globe:** click a leaderboard row and the Globe opens with that
  nation focused; the camera settles on it and its row is scrolled into view if
  you go back.
- **Cross-view surge toast:** when a nation surges while you're on the Globe, a
  small ▲ "_… is surging_" toast slides in at the top — so a spike reads no
  matter which of the two views you're looking at. (Rate-limited so it never
  spams.)

**Reduced motion:** if your system requests reduced motion, the chip stops
cycling, the surge toast is suppressed, and scroll-into-view jumps instead of
animating. The data stays just as live.

---

## How the site stays live

Two independent live signals feed the page:

**Match data** (scores, schedule, standings, bracket) refreshes from a backend
pipeline. As new results land, Matchday scores update and the Standings and
Bracket re-derive themselves from those scores. A "_Updated …_" timestamp on
the data views tells you how fresh it is. Confirmed final scores are never
overwritten.

**Buzz** is polled every ~4 seconds from a live feed. It is driven **only** by
real activity from the X (Twitter) API — per-nation post volume mapped onto each
country's score and spikes — while a match is live. There is no simulated
fallback: when no match is in play (or no X token is configured) the board
simply stays quiet and lights up again at the next kickoff.

**Privacy:** the buzz layer only ever stores **aggregate intensity per
country**. No post text, authors, or account IDs are kept or shown.

---

## Quick reference

| View | What it answers | Key interaction |
|------|-----------------|-----------------|
| **Buzz** | Who's loudest right now? | Click a row → spotlight on Globe |
| **Globe** | Where is everyone, and how's the energy? | Hover a nation; click the "Buzzing now" chip |
| **Matchday** | What happened / is happening today? | Scrub the date slider; click a fixture |
| **Standings** | Who's advancing? | Hover a team to trace it on the globe |
| **Bracket** | How might the knockouts play out? | Hover a matchup to highlight both nations |
