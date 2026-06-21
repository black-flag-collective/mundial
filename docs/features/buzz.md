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
- **🔥 Trending strip + badge** — when the live X feed is on, a strip of the
  hottest **World-Cup trends on X** (worldwide + host nations, with post counts)
  sits above the board, and any nation currently trending gets a **🔥 TRENDING**
  badge. This is *what's being said*, layered on top of *how loud* each nation is.

## What you can do

- **🔮 Ask the Oracle** — when the prediction feature is enabled (server has an
  Anthropic key), a button under the header asks the **Buzz Oracle** for a
  data-grounded call: the projected champion + final, a one-line take, and the
  buzz/form evidence behind it. **Share it** with one tap (native share sheet on
  mobile, copy-to-clipboard elsewhere) — the shared text carries the
  mundial.buzz link. It's an on-demand, cost-bounded AI call (cheap model,
  server-cached, rate-limited) — see [`HANDOFF.md`](../../HANDOFF.md).
- **Tap any row** to open the **inspect panel** — "what we're pulling from X"
  for that nation. When the live feed is active it shows the exact recent-counts
  query, the post volume + a per-minute **sparkline**, the **peak / current**
  rate, and — for a nation in a live match — the **head-to-head split** (which
  side is winning the match's chatter). If the nation is trending, it also lists
  **its own trending topics** (the "why" behind its 🔥 badge). For a nation that isn't being polled
  live, it explains *when* its match is (kicks off later / played earlier / not
  today) and notes its bar is ambient interest.

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
