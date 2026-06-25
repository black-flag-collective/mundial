/**
 * Buzz engine — tracks a live "social buzz" intensity per country for the
 * globe's beacon layer.
 *
 * Buzz is driven ONLY by real, measured signal — there is no simulated/ambient
 * fallback. With no live feed every score stays 0 and the globe is a static
 * map; buzz lights up only when real data is fed in via:
 *   - setSignals() / ingest() — rolling X (Twitter) post volume per country,
 *     from the cost-bounded counts poller or the filtered stream
 *     (see scripts/buzz-counts.js, scripts/x-stream*.js, server.js),
 *   - setAmbient() — a low background glow for nations trending on X but not in
 *     a live match, from the trends poller (see scripts/x-trends.js); keeps the
 *     globe breathing between fixtures, always dimmer than a live signal,
 *   - fireGoal() — a goal event, when the running process observes a score
 *     change on disk (data/matches.json).
 *
 * Note on goal spikes: fireGoal() only triggers when the *same* engine instance
 * sees matches.json change between reads. That happens in local dev or with an
 * in-process updater, but NOT in the current production model, where the data
 * is refreshed by a GitHub Action that commits matches.json and redeploys — each
 * deploy starts a fresh process, so cross-restart deltas are never observed.
 * Precise per-goal spikes need a persistent baseline or a delta feed from the
 * updater (not built here).
 *
 * The snapshot shape and the globe layer are unchanged whether the signal is
 * present or absent — downstream only ever sees real intensities (or zeros).
 *
 * Privacy: only aggregate intensity per country is ever kept. No tweet text,
 * authors, or ids are stored.
 */

const fs = require('fs');
const fsp = fs.promises;
const path = require('path');

const DATA_PATH = path.join(__dirname, '..', 'data', 'matches.json');

// Per-country "attention" weights (0..1), derived from a citable source — the
// FIFA/Coca-Cola Men's World Ranking (data/fifa-ranking.json). The engine no
// longer uses these to fabricate glow (buzz is real-signal-only); they are kept
// as the canonical nation list (keys) and as a transparent normalization prior
// referenced by the counts poller and the Oracle. A smooth descent from 1.0
// (rank 1) into a uniform baseline for nations outside the top 20.
// See docs/METHODOLOGY.md.
const { CODE_NAME } = require('./x-build-rules');
let RANKING = { ranks: {}, asOf: null, source: null };
try { RANKING = require('../data/fifa-ranking.json'); } catch { /* no file → all baseline */ }

const POP_BASELINE = 0.45; // nations outside the published FIFA top 20

function weightForRank(rank) {
  return Math.round(Math.max(POP_BASELINE, 1.0 - (rank - 1) * 0.028) * 100) / 100;
}
function buildPop(ranking = RANKING) {
  const ranks = (ranking && ranking.ranks) || {};
  const pop = {};
  for (const code of Object.keys(CODE_NAME)) pop[code] = ranks[code] ? weightForRank(ranks[code]) : POP_BASELINE;
  return pop;
}

const POP = buildPop();
const CODES = Object.keys(POP);

function clamp01(x) { return x < 0 ? 0 : x > 1 ? 1 : x; }

class BuzzEngine {
  constructor() {
    this.now = Date.now();
    this.state = {};
    CODES.forEach((code) => {
      // Nations start dark. Buzz is driven ONLY by real external signal
      // (ingest/surge/setSignals from the live X feed); with no feed every
      // score stays 0 and the globe is a static map.
      this.state[code] = { score: 0, spike: 0 };
    });
    this._lastScores = {};   // "dayIdx:matchIdx" -> { as, bs }
    this._dataMtime = 0;
    this._classified = {};   // code -> match state today (LIVE/UP/FT) or undefined
    this._tickMs = 2000;
    this._timer = null;
    this._ticking = false;
    this.signal = {};        // code -> external buzz level 0..1 (e.g. X counts); see setSignals()
    this.ambient = {};       // code -> low background glow 0..1 (e.g. X trends); see setAmbient()
  }

  start() {
    if (this._timer) return;
    this.reloadData(true).catch(err => console.error('[buzz] initial data load failed:', err.message));
    this._timer = setInterval(() => {
      this.tick().catch(err => console.error('[buzz] tick failed:', err.message));
    }, this._tickMs);
    if (this._timer.unref) this._timer.unref();
    console.log('[buzz] engine started (real-signal-only; idle until a live X feed or goal event)');
  }

  stop() { if (this._timer) { clearInterval(this._timer); this._timer = null; } }

  /** Read matches.json (when it changes), classify today's teams, detect goals.
   *  Async + non-blocking so the file I/O never stalls the event loop. */
  async reloadData(initial) {
    let stat;
    try { stat = await fsp.stat(DATA_PATH); } catch { return; }
    if (!initial && stat.mtimeMs === this._dataMtime) return;

    let data;
    try { data = JSON.parse(await fsp.readFile(DATA_PATH, 'utf8')); } catch { return; }
    if (!data || !Array.isArray(data.days) || !Array.isArray(data.dayMatches)) return;

    // Only advance the mtime watermark once we have valid data, so a read that
    // catches the file mid-write (parse fails) is retried on the next tick.
    this._dataMtime = stat.mtimeMs;

    // Determine "today" the same way server.js does.
    const todayShort = new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    let dayIdx = data.days.findIndex(d => d.short === todayShort);
    if (dayIdx < 0) dayIdx = data.days.length - 1;

    const classified = {};
    const todayMatches = data.dayMatches[dayIdx] || [];
    todayMatches.forEach((m, mi) => {
      const st = m.st === 'LIVE' || m.st === 'UP' || m.st === 'FT' ? m.st : 'UP';
      // Highest-priority state wins if a team somehow appears twice.
      const rank = { LIVE: 3, UP: 2, FT: 1 };
      [m.a, m.b].forEach(code => {
        if (!classified[code] || rank[st] > rank[classified[code]]) classified[code] = st;
      });

      // Goal detection: compare against last seen score for this fixture.
      const key = dayIdx + ':' + mi;
      const prev = this._lastScores[key];
      const as = m.as | 0, bs = m.bs | 0;
      if (!initial && prev) {
        if (as > prev.as) this.fireGoal(m.a, m.b);
        if (bs > prev.bs) this.fireGoal(m.b, m.a);
      }
      this._lastScores[key] = { as, bs };
    });

    this._classified = classified;
  }

  /** A goal just happened: big spike for the scorer, smaller for the opponent. */
  fireGoal(scorer, conceder) {
    if (this.state[scorer]) this.state[scorer].spike = clamp01(this.state[scorer].spike + 0.95);
    if (this.state[conceder]) this.state[conceder].spike = clamp01(this.state[conceder].spike + 0.55);
  }

  /**
   * Feed a real-time external signal for a country — e.g. one matching X Post
   * from the filtered stream (server.js → scripts/x-stream-runner.js). Each
   * call nudges the spike; tick() decays it, so sustained volume keeps a
   * country lit and a burst (goal, controversy) flares it. Source-agnostic by
   * design — see the header note on wiring in the X API. `weight` lets a louder
   * signal (high engagement) count for more than a single post.
   */
  ingest(code, weight = 1) {
    const s = this.state[code];
    if (!s) return;
    s.spike = clamp01(s.spike + 0.03 * weight);
  }

  /**
   * Add an immediate spike of a known magnitude (0..1) to a country — the
   * momentum pop when its X volume jumps minute-over-minute (a goal reaction,
   * a red card). Unlike ingest() (one post → tiny nudge), this takes the
   * already-computed surge size from the counts poller. tick() decays it.
   */
  surge(code, amount = 0.4) {
    const s = this.state[code];
    if (!s) return;
    s.spike = clamp01(s.spike + amount);
  }

  /**
   * Replace the external per-country buzz signal in one shot (atomic — codes
   * omitted from `map` are cleared). Each value is a sustained 0..1 level, NOT
   * a momentary spike: tick() raises a country's glow target to at least this
   * level, so a nation with high real-world volume pulses harder for as long as
   * the signal holds. Fed by the cost-effective counts poller
   * (scripts/buzz-counts.js → GET /2/tweets/counts/recent per active team).
   */
  setSignals(map) {
    const next = {};
    if (map) {
      for (const code of Object.keys(map)) {
        if (this.state[code]) next[code] = clamp01(map[code]);
      }
    }
    this.signal = next;
  }

  /**
   * Replace the per-country AMBIENT signal in one shot (atomic — same shape and
   * clamp as setSignals). This is a low background glow for nations that are
   * *trending* on X but not in a live match, so the globe breathes between
   * fixtures instead of going fully dark. It's a separate channel from
   * setSignals() so the two pollers never overwrite each other; tick() takes the
   * max of the two, so a live counts signal always dominates its own ambient
   * floor. Fed by the trends poller (scripts/x-trends.js → GET /2/trends/by_woeid).
   */
  setAmbient(map) {
    const next = {};
    if (map) {
      for (const code of Object.keys(map)) {
        if (this.state[code]) next[code] = clamp01(map[code]);
      }
    }
    this.ambient = next;
  }

  async tick() {
    // Re-entrancy guard: setInterval can fire again before an awaited tick
    // resolves; skip overlapping runs so _lastScores / goal spikes stay consistent.
    if (this._ticking) return;
    this._ticking = true;
    try {
      await this.reloadData(false);
      const now = Date.now();
      const dtMs = Math.min(now - this.now, 5000);
      this.now = now;

      for (const code of CODES) {
        const s = this.state[code];

        // Buzz is driven ONLY by real external signal (X counts via
        // setSignals/ingest; goal spikes via fireGoal/surge; X trends via
        // setAmbient). With no live feed and no trending presence, ext is 0 and
        // every score eases to 0 — no fabricated glow. The live counts signal
        // and the lower ambient (trends) floor are independent channels; we take
        // the max so a live match always outshines its own ambient background.
        const ext = Math.max(this.signal[code] || 0, this.ambient[code] || 0);
        const target = clamp01(ext);

        // Ease the steady glow toward target (~3s time constant).
        const k = 1 - Math.exp(-dtMs / 3000);
        s.score += (target - s.score) * k;

        // Spikes decay over ~12s. They are only ever raised by real events
        // (fireGoal/surge/ingest), never fabricated here.
        s.spike *= Math.pow(0.92, dtMs / this._tickMs);
        if (s.spike < 0.01) s.spike = 0;
      }
    } finally {
      this._ticking = false;
    }
  }

  /** Current buzz, sorted hottest-first with ranks. */
  snapshot() {
    const buzz = CODES.map(code => {
      const s = this.state[code];
      return {
        code,
        score: Math.round(clamp01(s.score) * 1000) / 1000,
        spike: Math.round(clamp01(s.spike) * 1000) / 1000
      };
    });
    buzz.sort((a, b) => (b.score + b.spike) - (a.score + a.spike));
    buzz.forEach((b, i) => { b.rank = i + 1; });
    return {
      updatedAt: new Date(this.now).toISOString(),
      window: 'live',
      // 'idle' when no real feed is driving buzz. The server overrides this to
      // 'counts' when the live X poller is active and a match is in play.
      source: 'idle',
      buzz
    };
  }
}

// Singleton — the server keeps one engine for the whole process.
let engine = null;
function getEngine() {
  if (!engine) engine = new BuzzEngine();
  return engine;
}

module.exports = { getEngine, BuzzEngine, weightForRank, buildPop, RANKING, POP };
