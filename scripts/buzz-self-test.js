'use strict';

/**
 * Unit tests for the buzz engine's pure logic — the signal interface the X
 * integration drives (ingest / surge / setSignals), spike decay, and the
 * snapshot shape/ranking the globe consumes. No network, no server, no timers
 * left running. Runs in CI via `npm test`.
 */

const assert = require('node:assert');
const { BuzzEngine, weightForRank, buildPop } = require('./buzz-engine');

let passed = 0;
const checks = [];
function check(name, fn) { checks.push({ name, fn }); }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

check('pop: weightForRank descends from 1.0 and clamps to the baseline', () => {
  assert.strictEqual(weightForRank(1), 1, 'rank 1 → 1.0');
  assert.ok(weightForRank(1) > weightForRank(6) && weightForRank(6) > weightForRank(15), 'monotonic by rank');
  assert.strictEqual(weightForRank(200), 0.45, 'deep ranks clamp to the baseline');
});
check('pop: buildPop seeds weights from the FIFA ranking, rest at baseline', () => {
  const pop = buildPop({ ranks: { ARG: 1, BRA: 6 } });
  assert.strictEqual(pop.ARG, 1, 'rank 1 nation weighted top');
  assert.ok(pop.BRA < pop.ARG && pop.BRA > 0.45, 'mid top-20 nation between top and baseline');
  assert.strictEqual(pop.GHA, 0.45, 'an unranked nation gets the baseline');
  for (const code of Object.keys(pop)) assert.ok(pop[code] >= 0.45 && pop[code] <= 1, code + ' in range');
  assert.ok(Object.keys(pop).length >= 48, 'covers the full field');
});
check('constructor: every nation starts in range, no spike', () => {
  const e = new BuzzEngine();
  const codes = Object.keys(e.state);
  assert.ok(codes.length >= 48, `expected the full nation set, got ${codes.length}`);
  for (const c of codes) {
    assert.ok(e.state[c].score >= 0 && e.state[c].score <= 1, `${c} score in 0..1`);
    assert.strictEqual(e.state[c].spike, 0, `${c} starts unspiked`);
  }
});

check('ingest: weight scales the nudge; unknown code is a no-op', () => {
  const e = new BuzzEngine();
  e.ingest('BRA', 1);
  const oneNudge = e.state.BRA.spike;
  e.state.BRA.spike = 0;
  e.ingest('BRA', 4);
  assert.ok(e.state.BRA.spike > oneNudge, 'heavier weight → bigger nudge');
  assert.doesNotThrow(() => e.ingest('ZZZ', 5), 'unknown code ignored');
});

check('surge: adds the given magnitude, clamped to 1', () => {
  const e = new BuzzEngine();
  e.surge('ARG', 0.4);
  assert.ok(Math.abs(e.state.ARG.spike - 0.4) < 1e-9, 'spike == amount');
  e.surge('ARG', 5);
  assert.strictEqual(e.state.ARG.spike, 1, 'clamped to 1, never above');
  assert.doesNotThrow(() => e.surge('ZZZ', 1), 'unknown code ignored');
});

check('setSignals: atomic replace, clamps, drops unknown/omitted codes', () => {
  const e = new BuzzEngine();
  e.setSignals({ BRA: 0.5, ARG: 2, ZZZ: 0.9 });
  assert.strictEqual(e.signal.BRA, 0.5);
  assert.strictEqual(e.signal.ARG, 1, 'clamped to 1');
  assert.ok(!('ZZZ' in e.signal), 'unknown code dropped');
  e.setSignals({ FRA: 0.3 });
  assert.deepStrictEqual(e.signal, { FRA: 0.3 }, 'replace is atomic — old codes cleared');
  e.setSignals(null);
  assert.deepStrictEqual(e.signal, {}, 'null clears all');
});

check('snapshot: sorted hottest-first with 1..n ranks and rounded values', () => {
  const e = new BuzzEngine();
  e.surge('BRA', 0.9);
  e.surge('ARG', 0.5);
  const snap = e.snapshot();
  assert.strictEqual(snap.source, 'idle', 'no live feed → idle source (server overrides to counts when live)');
  assert.ok(Array.isArray(snap.buzz) && snap.buzz.length === Object.keys(e.state).length);
  // Ranks are dense 1..n in sorted order.
  snap.buzz.forEach((b, i) => assert.strictEqual(b.rank, i + 1));
  for (let i = 1; i < snap.buzz.length; i++) {
    const prev = snap.buzz[i - 1], cur = snap.buzz[i];
    assert.ok((prev.score + prev.spike) >= (cur.score + cur.spike), 'descending by score+spike');
  }
  // BRA (biggest surge) should outrank ARG.
  const rankOf = (c) => snap.buzz.find((b) => b.code === c).rank;
  assert.ok(rankOf('BRA') < rankOf('ARG'), 'bigger surge ranks higher');
  for (const b of snap.buzz) {
    assert.ok(/^[A-Z]{3}$/.test(b.code), 'FIFA code');
    assert.strictEqual(b.score, Math.round(b.score * 1000) / 1000, 'score rounded to 3dp');
  }
});

check('tick: an external signal raises a nation’s glow floor', async () => {
  const e = new BuzzEngine();
  const before = e.state.CPV.score; // a low-popularity nation
  e.setSignals({ CPV: 1 });         // strong real-world volume
  await e.tick();
  await sleep(60);
  await e.tick();
  e.stop();
  assert.ok(e.state.CPV.score > before, 'score eased upward toward the signal floor');
});

check('tick: spikes decay over time (no random flares)', async () => {
  const e = new BuzzEngine();
  const realRandom = Math.random;
  Math.random = () => 0.999; // suppress flare branches so decay is deterministic
  try {
    e.surge('GER', 0.8);
    const before = e.state.GER.spike;
    await e.tick();
    await sleep(60);
    await e.tick();
    assert.ok(e.state.GER.spike < before, 'spike decayed');
    assert.ok(e.state.GER.spike >= 0, 'never negative');
  } finally {
    Math.random = realRandom;
    e.stop();
  }
});

(async () => {
  for (const { name, fn } of checks) {
    try {
      await fn();
      passed++;
      console.log('  ✅ ' + name);
    } catch (err) {
      console.error('  ❌ ' + name + ' — ' + err.message);
      process.exitCode = 1;
    }
  }
  if (process.exitCode) console.error('\nbuzz-self-test FAILED');
  else console.log(`\nbuzz-self-test passed (${passed} checks)`);
})();
