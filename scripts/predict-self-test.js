'use strict';

/**
 * Unit tests for the Buzz Oracle's pure logic and cost guards — no network, no
 * real AI call (the Anthropic client is stubbed). Runs in CI via `npm test`.
 */

const assert = require('node:assert');
const { createOracle, buildContext, summarizeResults, signatureOf, parsePrediction } = require('./predict');

let passed = 0;
const checks = [];
function check(name, fn) { checks.push({ name, fn }); }

// A stubbed Anthropic client that counts calls and returns a fixed JSON pick.
function stubClient(json) {
  const state = { calls: 0 };
  return {
    state,
    messages: {
      create: async () => { state.calls++; return { content: [{ type: 'text', text: typeof json === 'string' ? json : JSON.stringify(json) }] }; },
    },
  };
}
const PICK = { champion: 'BRA', championName: 'Brazil', runnerUp: 'FRA', finalScore: '2-1', hotTake: 'x', evidence: 'y' };

check('predict: summarizeResults tallies only finished matches', () => {
  const rec = summarizeResults({ dayMatches: [[
    { a: 'BRA', b: 'ARG', as: 2, bs: 0, st: 'FT' },
    { a: 'FRA', b: 'ENG', as: 1, bs: 1, st: 'FT' },
    { a: 'ESP', b: 'GER', st: 'UP' },
  ]] });
  assert.deepStrictEqual(rec.BRA, { w: 1, d: 0, l: 0, gf: 2, ga: 0 });
  assert.strictEqual(rec.ARG.l, 1);
  assert.strictEqual(rec.FRA.d, 1);
  assert.ok(!rec.ESP, 'upcoming match not counted');
});

check('predict: buildContext honestly separates real vs modeled buzz', () => {
  const args = {
    matches: { dayMatches: [[{ a: 'BRA', b: 'ARG', as: 3, bs: 0, st: 'FT' }]] },
    buzz: { buzz: [{ code: 'BRA', score: 1 }, { code: 'ARG', score: 0.5 }, { code: 'FRA', score: 0.4 }] },
    trends: { locations: [{ trends: [{ name: '#BRA', wc: true }, { name: 'Taylor Swift', wc: false }] }] },
  };
  // BRA is in a live match → real X volume; others are modeled.
  const live = buildContext({ ...args, liveCodes: ['BRA'], realActive: true });
  assert.ok(/Real X post volume now[^\n]*BRA/.test(live), 'live nation shown as real volume');
  assert.ok(/Modeled attention index[^\n]*(ARG|FRA)/.test(live), 'others shown as modeled');
  assert.ok(/NOT team strength/.test(live), 'buzz framed as attention, not strength');
  assert.ok(/\dW-\dD-\dL/.test(live), 'form line present');
  assert.ok(live.includes('#BRA') && !live.includes('Taylor'), 'WC trends only');
  // No live match → everything is explicitly modeled.
  const sim = buildContext({ ...args, liveCodes: [], realActive: false });
  assert.ok(/Real X post volume: none right now/.test(sim), 'no-live state is labelled MODELED');
  assert.ok(/MODELED, not measured/.test(sim));
});

check('predict: parsePrediction reads JSON and rejects junk', () => {
  assert.strictEqual(parsePrediction('not json'), null);
  assert.strictEqual(parsePrediction('{"foo":1}'), null, 'missing champion → null');
  const p = parsePrediction('noise {"champion":"arg","championName":"Argentina"} trailing');
  assert.strictEqual(p.champion, 'ARG', 'uppercased, extracted from surrounding text');
  assert.strictEqual(p.championName, 'Argentina');
});

check('predict: signatureOf is stable for the same top-8 buzz set', () => {
  const a = signatureOf({ buzz: [{ code: 'BRA' }, { code: 'ARG' }] });
  const b = signatureOf({ buzz: [{ code: 'BRA' }, { code: 'ARG' }, { code: 'FRA' }, { code: 'X' }, { code: 'Y' }, { code: 'Z' }, { code: 'W' }, { code: 'V' }, { code: 'IGNORED' }] });
  assert.strictEqual(signatureOf({ buzz: [{ code: 'BRA' }, { code: 'ARG' }] }), a, 'deterministic');
  assert.notStrictEqual(a, b, 'different sets differ');
});

check('predict: no client → unavailable (503)', async () => {
  const o = createOracle({ log: { error() {} } });
  await assert.rejects(() => o.predict({ context: 'c', signature: 's' }), (e) => e.status === 503);
});

check('predict: second request in the cache window reuses the pick (no new AI call)', async () => {
  const c = stubClient(PICK);
  const o = createOracle({ client: c, log: { error() {} } });
  const r1 = await o.predict({ context: 'c', signature: 'sig1', ip: '1', now: 1000 });
  assert.strictEqual(r1.cached, false);
  assert.strictEqual(r1.prediction.champion, 'BRA');
  const r2 = await o.predict({ context: 'c', signature: 'sig1', ip: '2', now: 2000 }); // diff ip, same signature, within TTL
  assert.strictEqual(r2.cached, true);
  assert.strictEqual(c.state.calls, 1, 'cache hit served without a second AI call');
});

check('predict: daily cap is a circuit breaker (serves cache, no new call)', async () => {
  process.env.X_PREDICT_DAILY_CAP = '1';
  const c = stubClient(PICK);
  const o = createOracle({ client: c, log: { error() {} } });
  await o.predict({ context: 'c', signature: 'A', ip: '1', now: 1000 });          // call #1
  const r = await o.predict({ context: 'c', signature: 'B', ip: '1', now: 60_000 }); // past rate window, new sig
  assert.strictEqual(c.state.calls, 1, 'cap blocks the 2nd AI call');
  assert.strictEqual(r.cached, true, 'falls back to the cached pick');
  assert.strictEqual(o.stats().capped, true);
  delete process.env.X_PREDICT_DAILY_CAP;
});

(async () => {
  for (const { name, fn } of checks) {
    try { await fn(); passed++; console.log('  ✅ ' + name); }
    catch (err) { console.error('  ❌ ' + name + ' — ' + err.message); process.exitCode = 1; }
  }
  if (process.exitCode) console.error('\npredict-self-test FAILED');
  else console.log(`\npredict-self-test passed (${passed} checks)`);
})();
