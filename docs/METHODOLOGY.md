# Methodology — what "buzzing" means, and how the Oracle predicts

This page defines the two things people most want to understand: **what a
nation's "buzz" score actually measures**, and **how that data drives the Buzz
Oracle's prediction**. It's written to be honest about where the number is real
and where it's modeled.

## What "buzzing" means

Each nation has a **buzz score** (shown 0–100) plus a momentary **spike**. The
leaderboard ranks by `score + spike`. The score eases (~3s smoothing) toward the
**higher of** two things ([`scripts/buzz-engine.js`](../scripts/buzz-engine.js)):

```
target = max( modeled_attention , real_X_volume )
         modeled_attention = popularity × match-day-state × gentle motion
         real_X_volume      = normalized X post count (when measured)
```

So **real X volume raises the floor** — a nation with strong live volume glows at
least that bright — while the modeled signal keeps the globe alive otherwise. The
**spike** is a short-lived pulse from goal-reaction surges, live-match flares, and
occasional viral pops; it decays over ~12s.

### Where the number comes from — three honest tiers

| Tier | When | What the score is |
|------|------|-------------------|
| **Measured** (real X) | A nation **in a live match**, with `X_BEARER_TOKEN` + counts mode on | Its **real X post volume** over the last ~10 min ([`buzz-counts.js`](../scripts/buzz-counts.js)), normalized against the loudest live nation. This is the only genuinely "live X buzz." |
| **Modeled** (ambient) | Every other nation, even with a token | A popularity weight × match-day state (live / upcoming / finished / idle) × smooth motion. An **attention estimate**, not measured volume. The UI labels these nations' bars "ambient interest." |

The **popularity weight** is not hand-set — it's derived from a citable source,
the **FIFA/Coca-Cola Men's World Ranking** (`data/fifa-ranking.json`, the
**11 June 2026** release), used as a transparent proxy for how much a nation
tends to draw attention. The published **top 20** are weighted by their rank
(a smooth `weight = max(0.45, 1.0 − (rank−1)×0.028)`, so rank 1 → 1.0 and the
curve eases into the baseline by ~rank 20); every nation **outside the published
top 20** gets a uniform **0.45** baseline. It's a *prior*, not a precise
popularity figure — and it's overridden entirely by real X volume whenever a
nation is in a live match. (FIFA ranking measures strength, which correlates
with attention; we use it as the best citable, dated proxy available, not as a
claim that the buzz reflects team quality.)
| **Simulated** | No token configured | *All* nations use the modeled signal. The experience is identical, but nothing is real X data — the eyebrow reads "Buzz · simulated." |

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
