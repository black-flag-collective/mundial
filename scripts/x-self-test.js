'use strict';

/**
 * Unit tests for the X integration's pure logic — backoff policy, rule
 * generation, and the cost-bounded counts poller. Runs in CI via `npm test`.
 * No real network (fetch is stubbed), no server.
 */

const assert = require('node:assert');
const { backoff } = require('./x-stream-runner');
const { buildTeamRules, ruleForTeam, codesInFixtures, CODE_NAME } = require('./x-build-rules');
const { createCountsPoller, activeTeamCodes, liveContext, computeTrend } = require('./buzz-counts');

let passed = 0;
const checks = [];
function check(name, fn) { checks.push({ name, fn }); }

check('backoff: 409 yields hard (>= 30s), not aggressive linear', () => {
  const d = backoff(0, { status: 409 });
  assert.ok(d >= 30_000 && d <= 31_000, `got ${d}`);
});
check('backoff: 409 grows toward a 5m cap', () => {
  assert.ok(backoff(30_000, { status: 409 }) >= 60_000);
  assert.ok(backoff(10_000_000, { status: 409 }) <= 301_000);
});
check('backoff: 429 honors x-rate-limit-reset', () => {
  const d = backoff(0, { status: 429, rateLimitResetMs: Date.now() + 120_000 });
  assert.ok(d >= 120_000 && d <= 123_000, `got ${d}`);
});
check('backoff: 429 honors retry-after', () => {
  const d = backoff(0, { status: 429, retryAfterMs: 90_000 });
  assert.ok(d >= 90_000 && d <= 93_000, `got ${d}`);
});
check('backoff: 429 without headers is exponential, capped 15m', () => {
  assert.ok(backoff(60_000, { status: 429 }) >= 120_000);
  assert.ok(backoff(10_000_000, { status: 429 }) <= 901_000);
});
check('backoff: 5xx exponential (5s base, then doubles)', () => {
  assert.ok(backoff(0, { status: 503 }) >= 5_000);
  assert.ok(backoff(5_000, { status: 503 }) >= 10_000);
});
check('backoff: network/stall is gentle linear, cap 16s', () => {
  assert.strictEqual(backoff(0, {}), 250);
  assert.strictEqual(backoff(250, {}), 500);
  assert.strictEqual(backoff(10_000_000, {}), 16_000);
});

check('rules: one per nation (48), each tagged with a real FIFA code', () => {
  const rules = buildTeamRules();
  assert.strictEqual(rules.length, 48);
  for (const r of rules) {
    assert.ok(/^[A-Z]{3}$/.test(r.tag), `bad tag ${r.tag}`);
    assert.ok(CODE_NAME[r.tag], `tag ${r.tag} not a known nation`);
  }
});
check('rules: every rule under the 1,000-char cap', () => {
  for (const r of buildTeamRules()) assert.ok(r.value.length <= 1000, `${r.tag} is ${r.value.length} chars`);
});
check('rules: carry WC context filter and exclude retweets', () => {
  for (const r of buildTeamRules()) {
    assert.ok(r.value.includes('-is:retweet'));
    assert.ok(/WorldCup2026|world cup/i.test(r.value));
  }
});
check('rules: ruleForTeam includes name, aliases, hashtag', () => {
  const r = ruleForTeam('BRA');
  assert.ok(r.value.includes('"Brazil"') && r.value.includes('"Brasil"') && r.value.includes('#BRA'));
  assert.strictEqual(r.tag, 'BRA');
});

check('counts: activeTeamCodes returns known FIFA codes (subset)', () => {
  const codes = activeTeamCodes();
  assert.ok(Array.isArray(codes));
  for (const c of codes) assert.ok(/^[A-Z]{3}$/.test(c), c);
});
const LIVE_CTX = () => ({ codes: ['BRA', 'ARG', 'FRA'], phase: 'live' });
check('counts: cycle normalizes volume to 0..1 and feeds the engine', async () => {
  process.env.X_BEARER_TOKEN = 'test';
  let n = 0;
  global.fetch = async () => ({ ok: true, headers: { get: () => null }, json: async () => ({ meta: { total_tweet_count: ++n * 10 } }) });
  let got = null;
  const engine = { state: { BRA: {}, ARG: {}, FRA: {} }, setSignals(m) { got = m; }, surge() {} };
  const poller = createCountsPoller({ engine, log: { warn() {}, error() {} }, context: LIVE_CTX });
  await poller.cycle();
  assert.strictEqual(Object.keys(got).length, 3, 'one signal per polled team');
  for (const v of Object.values(got)) assert.ok(v >= 0 && v <= 1, 'signal in 0..1: ' + v);
  assert.strictEqual(Math.max(...Object.values(got)), 1, 'hottest normalizes to 1');
  delete global.fetch; delete process.env.X_BEARER_TOKEN;
});
check('counts: hard cap trips the circuit breaker (clears signals)', async () => {
  process.env.X_BEARER_TOKEN = 'test';
  process.env.X_COUNTS_DAILY_CAP = '1'; // below the polled-team count → can't finish a cycle
  global.fetch = async () => ({ ok: true, headers: { get: () => null }, json: async () => ({ meta: { total_tweet_count: 5 } }) });
  let got = 'unset';
  const engine = { state: { BRA: {}, ARG: {}, FRA: {} }, setSignals(m) { got = m; }, surge() {} };
  const poller = createCountsPoller({ engine, log: { warn() {}, error() {} }, context: LIVE_CTX });
  await poller.cycle();
  assert.deepStrictEqual(got, {}, 'capped → signals cleared (fades to simulation)');
  assert.strictEqual(poller.stats().capped, true);
  delete global.fetch; delete process.env.X_BEARER_TOKEN; delete process.env.X_COUNTS_DAILY_CAP;
});
check('counts: a minute-over-minute jump fires a surge (goal-reaction pop)', async () => {
  process.env.X_BEARER_TOKEN = 'test';
  // Flat history then a big final minute for BRA; flat for the rest.
  global.fetch = async (url) => ({
    ok: true,
    headers: { get: () => null },
    json: async () => decodeURIComponent(url).includes('"Brazil"')
      ? { meta: { total_tweet_count: 130 }, data: [{ tweet_count: 10 }, { tweet_count: 10 }, { tweet_count: 110 }] }
      : { meta: { total_tweet_count: 30 }, data: [{ tweet_count: 10 }, { tweet_count: 10 }, { tweet_count: 10 }] },
  });
  const surged = {};
  const engine = { state: { BRA: {}, ARG: {}, FRA: {} }, setSignals() {}, surge(c, a) { surged[c] = a; } };
  const poller = createCountsPoller({ engine, log: { warn() {}, error() {} }, context: LIVE_CTX });
  await poller.cycle();
  assert.ok(surged.BRA > 0, 'BRA surged on the volume jump');
  assert.ok(!('ARG' in surged) && !('FRA' in surged), 'flat nations did not surge');
  assert.ok(poller.stats().perTeam.BRA.trend > 0.25, 'BRA trend rising');
  delete global.fetch; delete process.env.X_BEARER_TOKEN;
});
check('counts: computeTrend reads rising / steady / falling', () => {
  assert.ok(computeTrend([{ tweet_count: 5 }, { tweet_count: 5 }, { tweet_count: 50 }]).trend > 0.3, 'rising');
  assert.strictEqual(computeTrend([{ tweet_count: 10 }, { tweet_count: 10 }, { tweet_count: 10 }]).trend, 0, 'steady');
  assert.ok(computeTrend([{ tweet_count: 50 }, { tweet_count: 50 }, { tweet_count: 2 }]).trend < -0.3, 'falling');
  assert.strictEqual(computeTrend([]).trend, 0, 'no data → flat');
});
check('counts: liveContext polls only teams in their kickoff window', () => {
  const now = Date.parse('2026-06-22T21:30:00Z'); // 30m into FRA v IRQ
  const matches = {
    dayMatches: [[
      { a: 'FRA', b: 'IRQ', ko: '2026-06-22T21:00:00Z' }, // live (now − ko = 30m)
      { a: 'BRA', b: 'ARG', ko: '2026-06-23T18:00:00Z' }, // tomorrow → not yet
      { a: 'ESP', b: 'GER', ko: '2026-06-22T12:00:00Z' }, // ended hours ago → idle
    ]],
  };
  const ctx = liveContext({ now, matches, matchMin: 150, cooldownMin: 30 });
  assert.strictEqual(ctx.phase, 'live');
  assert.deepStrictEqual([...ctx.codes].sort(), ['FRA', 'IRQ']);
  // Nothing live at 4am → idle, zero teams (no requests would be made).
  const quiet = liveContext({ now: Date.parse('2026-06-23T04:00:00Z'), matches });
  assert.strictEqual(quiet.phase, 'idle');
  assert.strictEqual(quiet.codes.length, 0);
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
  if (process.exitCode) console.error('\nx-self-test FAILED');
  else console.log(`\nx-self-test passed (${passed} checks)`);
})();
