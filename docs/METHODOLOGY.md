# Methodology — what "buzzing" means, and how the Oracle predicts

This page defines the two things people most want to understand: **what a
nation's "buzz" score actually measures**, and **how that data drives the Buzz
Oracle's prediction**. It's written to be honest about where the number is real
and where it's modeled.

## What "buzzing" means

Each nation has a **buzz score** (shown 0–100) plus a momentary **spike**. The
leaderboard ranks by `score + spike`. The score eases (~3s smoothing) toward a
target driven **only by real, measured signal** ([`scripts/buzz-engine.js`](../scripts/buzz-engine.js)):

```
target = real_X_volume   — normalized X post count while a nation is in a live match
       = 0               — whenever there is no live signal (the nation stays dark)
```

So buzz is **real or it is nothing**: a nation glows exactly as bright as its
live X volume, and with no live signal its score eases to **0** — there is no
modeled, ambient, or simulated glow. The **spike** is a short-lived pulse raised
only by real events — a goal (detected from a score change in `data/matches.json`)
or a sharp minute-over-minute jump in X volume; it decays over ~12s.

### Where the number comes from — three honest tiers

| State | When | What the score is |
|-------|------|-------------------|
| **Measured** (real X) | A nation **in a live match**, with `X_BEARER_TOKEN` + counts mode on | Its **real X post volume** over the last ~10 min ([`buzz-counts.js`](../scripts/buzz-counts.js)), normalized against the loudest live nation. This is the only thing that lights the globe. |
| **Idle** (dark) | No live match, or no token configured | The score is **0** and the globe is a static map. Nothing is fabricated — the UI says the board is quiet and it fills back in at the next kickoff. |

The **FIFA/Coca-Cola Men's World Ranking** (`data/fifa-ranking.json`, the
**11 June 2026** release) is still kept, but it **no longer adds any buzz**: it
serves only as the canonical 48-nation list and as a citable popularity *prior*
(its rank weights — `weight = max(0.45, 1.0 − (rank−1)×0.028)`, so rank 1 → 1.0,
easing into a **0.45** baseline by ~rank 20 — are available to the Buzz Oracle,
documented below). A nation with no live X signal scores **0** regardless of its
ranking. (FIFA ranking measures strength, which correlates with attention; we use
it as the best citable, dated proxy available, not as a claim that buzz reflects
team quality.)

The poller only spends X requests on the nations whose match is **live right now**
(plus a short cooldown), so on any given day only a handful of nations are ever in
the "measured" tier at once; the rest of the board is modeled. The UI is explicit
about this — see the "what we're pulling from X" inspect panel and the
[buzz feature doc](features/buzz.md).

### What buzz is — and isn't

- It is a measure of **attention** — how much a nation is being *talked about*.
- It is **not** a measure of team strength, form, or a win probability.
- **Privacy:** only aggregate per-country intensity is ever stored — no post
  text, authors, or account IDs. See [X-API-REALTIME.md](X-API-REALTIME.md).

## How the Buzz Oracle predicts

The [Buzz Oracle](../scripts/predict.js) (`/api/predict`) is an **on-demand AI
read**, not a statistical forecast. When you tap "Ask the Oracle" it builds a
compact context and asks a cheap model (`claude-haiku-4-5`) for a pick. It is fed
**three clearly-separated signals**:

1. **Buzz**, split honestly into the **measured** nations (real X volume, live
   matches) and the **modeled** attention index — and told, in the system prompt,
   that buzz is *attention, not strength*.
2. **Results / form so far** — the hard data (W-D-L from finished matches).
3. **Trending topics** on X.

The model is instructed to **weight results/form most** for who actually wins, and
to use buzz + trends only as the "what the world is watching" angle and narrative
color — and to **cite the specific signal** behind its call in the `evidence`
field. So the prediction is an interpretive synthesis ("the world's attention,
read against the form"), explicitly **not** a betting line.

It's cost-bounded by design: cheapest model, a server-side cache so many viewers
share one call, a per-client rate limit, and a hard daily cap — see
[HANDOFF.md](../HANDOFF.md#buzz-oracle-on-demand-ai-prediction).
