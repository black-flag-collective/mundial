'use strict';

/** Unit tests for the rate limiter's pure logic. No server, no network. */

const assert = require('node:assert');
const { createRateLimiter, clientIp } = require('./rate-limit');

let passed = 0;
const checks = [];
function check(name, fn) { checks.push({ name, fn }); }

// Minimal req/res stubs that record what the middleware does.
function fakeReq(ip) { return { headers: { 'x-forwarded-for': ip }, ip: '10.0.0.1' }; }
function fakeRes() {
  const r = { headers: {}, statusCode: null, body: null, _next: false };
  r.set = (k, v) => { r.headers[k.toLowerCase()] = v; return r; };
  r.status = (c) => { r.statusCode = c; return r; };
  r.json = (b) => { r.body = b; return r; };
  return r;
}
function run(mw, req) { const res = fakeRes(); let nexted = false; mw(req, res, () => { nexted = true; }); return { res, nexted }; }

check('rate-limit: clientIp takes the first x-forwarded-for hop', () => {
  assert.strictEqual(clientIp({ headers: { 'x-forwarded-for': '203.0.113.7, 10.0.0.1' } }), '203.0.113.7');
  assert.strictEqual(clientIp({ headers: {}, ip: '198.51.100.4' }), '198.51.100.4');
  assert.strictEqual(clientIp({ headers: {} }), 'anon');
});

check('rate-limit: allows up to max, then 429s with Retry-After', () => {
  let t = 1_000_000;
  const rl = createRateLimiter({ windowMs: 60_000, max: 2, now: () => t });
  const ip = fakeReq('1.1.1.1');
  assert.strictEqual(run(rl.middleware, ip).nexted, true, 'req 1 allowed');
  assert.strictEqual(run(rl.middleware, ip).nexted, true, 'req 2 allowed');
  const third = run(rl.middleware, ip);
  assert.strictEqual(third.nexted, false, 'req 3 blocked');
  assert.strictEqual(third.res.statusCode, 429);
  assert.ok(Number(third.res.headers['retry-after']) > 0, 'Retry-After set');
});

check('rate-limit: separate IPs have separate budgets', () => {
  let t = 5_000_000;
  const rl = createRateLimiter({ windowMs: 60_000, max: 1, now: () => t });
  assert.strictEqual(run(rl.middleware, fakeReq('2.2.2.2')).nexted, true);
  assert.strictEqual(run(rl.middleware, fakeReq('2.2.2.2')).nexted, false, 'same IP capped');
  assert.strictEqual(run(rl.middleware, fakeReq('3.3.3.3')).nexted, true, 'different IP fresh');
});

check('rate-limit: window resets after windowMs; prune drops stale entries', () => {
  let t = 9_000_000;
  const rl = createRateLimiter({ windowMs: 1_000, max: 1, now: () => t });
  const ip = fakeReq('4.4.4.4');
  assert.strictEqual(run(rl.middleware, ip).nexted, true);
  assert.strictEqual(run(rl.middleware, ip).nexted, false, 'capped within window');
  t += 1_001; // advance past the window
  assert.strictEqual(run(rl.middleware, ip).nexted, true, 'allowed again after reset');
  t += 2_000;
  rl.prune();
  assert.strictEqual(rl.hits.size, 0, 'expired entries pruned');
});

(async () => {
  for (const { name, fn } of checks) {
    try { await fn(); passed++; console.log('  ✅ ' + name); }
    catch (err) { console.error('  ❌ ' + name + ' — ' + err.message); process.exitCode = 1; }
  }
  if (process.exitCode) console.error('\nrate-limit-self-test FAILED');
  else console.log(`\nrate-limit-self-test passed (${passed} checks)`);
})();
