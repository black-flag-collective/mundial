'use strict';

/**
 * Unit tests for the X integration's pure logic (backoff policy + rule
 * generation). Runs in CI as part of `npm test`. No network, no server.
 */

const assert = require('node:assert');
const { backoff } = require('./x-stream-runner');
const { buildTeamRules, ruleForTeam, codesInFixtures, CODE_NAME } = require('./x-build-rules');

let passed = 0;
function check(name, fn) {
  try {
    fn();
    passed++;
    console.log('  ✅ ' + name);
  } catch (err) {
    console.error('  ❌ ' + name + ' — ' + err.message);
    process.exitCode = 1;
  }
}

console.log('backoff policy');

check('409 yields hard (>= 30s), not the aggressive linear path', () => {
  const d = backoff(0, { status: 409 });
  assert.ok(d >= 30_000 && d <= 31_000, `got ${d}`);
});

check('409 grows toward a 5m cap', () => {
  assert.ok(backoff(30_000, { status: 409 }) >= 60_000);
  assert.ok(backoff(10_000_000, { status: 409 }) <= 301_000); // cap 5m + jitter
});

check('429 honors x-rate-limit-reset when present', () => {
  const d = backoff(0, { status: 429, rateLimitResetMs: Date.now() + 120_000 });
  assert.ok(d >= 120_000 && d <= 123_000, `got ${d}`);
});

check('429 honors retry-after when present', () => {
  const d = backoff(0, { status: 429, retryAfterMs: 90_000 });
  assert.ok(d >= 90_000 && d <= 93_000, `got ${d}`);
});

check('429 without headers falls back to exponential, capped at 15m', () => {
  assert.ok(backoff(60_000, { status: 429 }) >= 120_000);
  assert.ok(backoff(10_000_000, { status: 429 }) <= 901_000);
});

check('5xx is exponential (5s base, then doubles)', () => {
  assert.ok(backoff(0, { status: 503 }) >= 5_000, 'first 5xx >= 5s');
  assert.ok(backoff(5_000, { status: 503 }) >= 10_000, 'second 5xx >= 10s');
});

check('network/stall (no status) is gentle linear, cap 16s', () => {
  assert.strictEqual(backoff(0, {}), 250);
  assert.strictEqual(backoff(250, {}), 500);
  assert.strictEqual(backoff(10_000_000, {}), 16_000);
});

console.log('rule generation');

check('builds one rule per nation (48), each tagged with a real FIFA code', () => {
  const rules = buildTeamRules();
  assert.strictEqual(rules.length, 48);
  for (const r of rules) {
    assert.ok(/^[A-Z]{3}$/.test(r.tag), `bad tag ${r.tag}`);
    assert.ok(CODE_NAME[r.tag], `tag ${r.tag} not a known nation`);
  }
});

check('every rule stays under the 1,000-char pay-per-use cap', () => {
  for (const r of buildTeamRules()) assert.ok(r.value.length <= 1000, `${r.tag} is ${r.value.length} chars`);
});

check('rules carry the World-Cup context filter and exclude retweets', () => {
  for (const r of buildTeamRules()) {
    assert.ok(r.value.includes('-is:retweet'), `${r.tag} missing -is:retweet`);
    assert.ok(/WorldCup2026|world cup/i.test(r.value), `${r.tag} missing context`);
  }
});

check('ruleForTeam includes name, aliases, and the hashtag', () => {
  const r = ruleForTeam('BRA');
  assert.ok(r.value.includes('"Brazil"') && r.value.includes('"Brasil"') && r.value.includes('#BRA'));
  assert.strictEqual(r.tag, 'BRA');
});

check('codesInFixtures returns a subset of the known nations', () => {
  const codes = codesInFixtures();
  assert.ok(Array.isArray(codes));
  for (const c of codes) assert.ok(CODE_NAME[c], `fixture code ${c} unknown`);
});

if (process.exitCode) {
  console.error('\nx-self-test FAILED');
} else {
  console.log(`\nx-self-test passed (${passed} checks)`);
}
