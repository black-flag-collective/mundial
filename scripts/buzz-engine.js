/**
 * Buzz engine — produces a live "social buzz" intensity per country for the
 * globe's beacon layer.
 *
 * This is the SIMULATED / GOAL-DERIVED source. It needs no external account and
 * runs for free. Buzz is synthesized from:
 *   - a rough per-country popularity weight (fan-base / social volume),
 *   - who is playing today / live (read from data/matches.json),
 *   - goal events (detected as scores change between data refreshes),
 *   - smooth procedural noise so the globe always feels alive.
 *
 * It is intentionally source-agnostic: to wire in the real X API later, replace
 * `pump()` with an adapter that increments `count[code]` from the filtered
 * stream (Pro) or recent-search polling (pay-per-use). Everything downstream —
 * the score model, the snapshot shape, the globe layer — stays the same.
 *
 * Privacy: only aggregate intensity per country is ever kept. No tweet text,
 * authors, or ids are stored.
 */

const fs = require('fs');
const fsp = fs.promises;
const path = require('path');

const DATA_PATH = path.join(__dirname, '..', 'data', 'matches.json');

// Rough relative social-volume weights (0..1). Drives the ambient glow so that
// big footballing nations always hum a little louder than the minnows.
const POP = {
  BRA: 1.0, ARG: 1.0, FRA: 0.95, ENG: 0.95, GER: 0.9, ESP: 0.9, POR: 0.9,
  MEX: 0.8, USA: 0.78, NED: 0.75, BEL: 0.7, COL: 0.7, MAR: 0.7, JPN: 0.68,
  KOR: 0.65, TUR: 0.62, URU: 0.6, SEN: 0.6, CRO: 0.6, EGY: 0.6, SUI: 0.55,
  SWE: 0.55, NOR: 0.55, IRN: 0.55, GHA: 0.55, CIV: 0.55, ALG: 0.55, ECU: 0.52,
  CZE: 0.5, SCO: 0.5, AUS: 0.5, AUT: 0.5, TUN: 0.5, KSA: 0.5, CAN: 0.5, RSA: 0.5,
  PAR: 0.45, COD: 0.45, IRQ: 0.45, BIH: 0.42, UZB: 0.4, JOR: 0.4, PAN: 0.4,
  QAT: 0.4, NZL: 0.35, HAI: 0.35, CUW: 0.3, CPV: 0.3
};
const DEFAULT_POP = 0.45;

const CODES = Object.keys(POP);

// Activity multipliers applied on top of popularity, by match state today.
const MULT = { LIVE: 1.75, UP: 1.0, FT: 0.85, IDLE: 0.5 };

function clamp01(x) { return x < 0 ? 0 : x > 1 ? 1 : x; }

class BuzzEngine {
  constructor() {
    this.now = Date.now();
    this.state = {};
    CODES.forEach((code, i) => {
      this.state[code] = {
        score: clamp01((POP[code] ?? DEFAULT_POP) * MULT.IDLE),
        spike: 0,
        phase: (i * 2.39996) % (Math.PI * 2), // golden-angle spread
        drift: 0
      };
    });
    this._lastScores = {};   // "dayIdx:matchIdx" -> { as, bs }
    this._dataMtime = 0;
    this._classified = {};   // code -> match state today (LIVE/UP/FT) or undefined
    this._tickMs = 2000;
    this._timer = null;
    this._ticking = false;
  }

  start() {
    if (this._timer) return;
    this.reloadData(true).catch(() => {});
    this._timer = setInterval(() => { this.tick().catch(() => {}); }, this._tickMs);
    if (this._timer.unref) this._timer.unref();
    console.log('[buzz] engine started (simulated / goal-derived source)');
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
      const t = now * 0.001;

      for (const code of CODES) {
        const s = this.state[code];
        const stClass = this._classified[code] || 'IDLE';
        const base = POP[code] ?? DEFAULT_POP;

        // Smooth procedural chatter: slow sine + a gentle random walk.
        s.drift += (Math.random() - 0.5) * 0.06;
        s.drift = Math.max(-0.25, Math.min(0.25, s.drift * 0.92));
        const noise = 0.55 + 0.3 * Math.sin(t * 0.27 + s.phase) + s.drift;

        const target = clamp01(base * MULT[stClass] * noise);

        // Ease the steady glow toward target (~3s time constant).
        const k = 1 - Math.exp(-dtMs / 3000);
        s.score += (target - s.score) * k;

        // Live teams occasionally flare (near-miss, big chance, card).
        if (stClass === 'LIVE' && Math.random() < 0.05) {
          s.spike = clamp01(s.spike + 0.35 + Math.random() * 0.3);
        }

        // Spikes decay over ~12s.
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
      source: 'simulated',
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

module.exports = { getEngine, BuzzEngine };
