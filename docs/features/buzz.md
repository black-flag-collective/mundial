# 🔥 Buzz — "Who the world is watching"

The default landing point for live attention: a leaderboard of the nations
generating the most chatter right now, ranked by a **buzz score**.

## What you see

- **Live count + timestamp** — "_N nations buzzing · updated …_" sits above the
  board and refreshes every few seconds.
- **Leaderboard rows** — each row shows:
  - **Rank** (top three highlighted)
  - **Flag** and **FIFA code** (e.g. `BRA`) + country name
  - A **score bar** showing intensity relative to the loudest nation
  - The numeric **score**
- **▲ SURGING badge** — appears on a nation whose chatter just spiked sharply
  (a goal, a result, a viral moment). It's the "something is happening _now_"
  signal, distinct from a steadily high score.

## What you can do

- **Click any row** to jump to the [Globe](globe.md) with that nation
  spotlighted. When you return, that row scrolls back into view.

## States

| State | When | What shows |
|-------|------|------------|
| Loading | first load, before any data | spinner — "_Tuning into the chatter…_" |
| Empty | before posts start flowing | "_All quiet… for now_" |
| Live | normal | the leaderboard |
| Error | feed unreachable | "_Lost the signal_" + **Try again** |

## How it stays live

The board polls the buzz feed every ~4 seconds. The feed can be driven by real
X (Twitter) activity (per-nation post volume → score and spikes) or by a
built-in simulated source — the experience is identical either way. Only
**aggregate intensity per country** is stored; no post text, authors, or
account IDs.

See also: [Globe](globe.md) · [full feature tour](../FEATURES.md)
