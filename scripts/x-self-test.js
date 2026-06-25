'use strict';

/**
 * Unit tests for the X integration's pure logic — backoff policy, rule
 * generation, and the cost-bounded counts poller. Runs in CI via `npm test`.
 * No real network (fetch is stubbed), no server.
 */

const assert = require('node:assert');
const { backoff } = require('./x-stream-runner');
const { streamPosts, postWeight } = require('./x-stream');
const { parseTrends, isWorldCupTrend, createTrendsPoller, codeForTrend, trendsToAmbient } = require('./x-trends');
const { buildTeamRules, ruleForTeam, codesInFixtures, CODE_NAME } = require('./x-build-rules');
const { createCountsPoller, activeTeamCodes, liveContext, computeTrend, resolveBuzzMode, dueForFetch, liveDelay, isKnockout, absoluteScale, decayPeak } = require('./buzz-counts');

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
check('counts: buzz source defaults to cost-safe counts; firehose is opt-in', () => {
  assert.strictEqual(resolveBuzzMode({}), 'counts', 'no env → cost-bounded counts');
  assert.strictEqual(resolveBuzzMode({ X_BUZZ_MODE: 'counts' }), 'counts');
  assert.strictEqual(resolveBuzzMode({ X_BUZZ_MODE: 'stream' }), 'stream', 'firehose only when explicit');
  assert.strictEqual(resolveBuzzMode({ X_BUZZ_MODE: 'anything-else' }), 'counts', 'unknown → counts');
});
check('counts: dueForFetch — live every cycle, others on the slow tier', () => {
  const now = 1_000_000;
  assert.strictEqual(dueForFetch('live', now - 1, now, 300000), true, 'live always due');
  assert.strictEqual(dueForFetch('cooldown', now - 10000, now, 300000), false, 'cooldown not due yet');
  assert.strictEqual(dueForFetch('cooldown', now - 300000, now, 300000), true, 'cooldown due after slow interval');
  assert.strictEqual(dueForFetch('warmup', 0, now, 300000), true, 'never-fetched non-live is due');
});
check('counts: live polled every cycle; cooldown holds its signal on the slow tier', async () => {
  process.env.X_BEARER_TOKEN = 'test';
  process.env.X_COUNTS_PULSE_DISABLED = '1'; // isolate team-poll cadence from the tournament pulse
  let fetches = 0;
  global.fetch = async () => { fetches++; return { ok: true, headers: { get: () => null }, json: async () => ({ meta: { total_tweet_count: 50 }, data: [{ tweet_count: 50 }] }) }; };
  const sigs = [];
  const engine = { state: { BRA: {}, ARG: {} }, setSignals(m) { sigs.push(m); }, surge() {} };
  const ctx = () => ({ codes: ['BRA', 'ARG'], phase: 'live', phases: { BRA: 'live', ARG: 'cooldown' } });
  const poller = createCountsPoller({ engine, log: { warn() {}, error() {} }, context: ctx });
  await poller.cycle();           // cycle 1: both fetched (ARG never polled before)
  const afterFirst = fetches;
  await poller.cycle();           // cycle 2 (immediate): only BRA (live) re-fetched
  assert.strictEqual(afterFirst, 2, 'first cycle fetches both');
  assert.strictEqual(fetches - afterFirst, 1, 'second cycle fetches only the live team');
  const last = sigs[sigs.length - 1];
  assert.ok('ARG' in last && last.ARG > 0, 'cooldown team keeps its signal between slow polls');
  delete global.fetch; delete process.env.X_BEARER_TOKEN; delete process.env.X_COUNTS_PULSE_DISABLED;
});
check('counts: a 429 pauses polling until the reset window (no hammering)', async () => {
  process.env.X_BEARER_TOKEN = 'test';
  let calls = 0;
  const resetSec = Math.floor(Date.now() / 1000) + 900; // 15 min out
  global.fetch = async () => {
    calls++;
    return { ok: false, status: 429, headers: { get: (h) => (h === 'x-rate-limit-reset' ? String(resetSec) : null) }, json: async () => ({}) };
  };
  const engine = { state: { BRA: {}, ARG: {} }, setSignals() {}, surge() {} };
  const ctx = () => ({ codes: ['BRA', 'ARG'], phase: 'live', phases: { BRA: 'live', ARG: 'live' } });
  const poller = createCountsPoller({ engine, log: { warn() {}, error() {} }, context: ctx });
  await poller.cycle();                       // hits 429 on first team, breaks
  assert.strictEqual(calls, 1, 'stops after the first 429 instead of trying every team');
  assert.strictEqual(poller.stats().rateLimited, true, 'flagged rate-limited');
  assert.ok(poller.stats().pausedUntilMs > Date.now(), 'paused until the reset window');
  await poller.cycle();                       // still within the pause → no new requests
  assert.strictEqual(calls, 1, 'no requests spent while paused');
  delete global.fetch; delete process.env.X_BEARER_TOKEN;
});
check('counts: liveContext reports per-nation phase', () => {
  const now = Date.parse('2026-06-22T21:30:00Z');
  const matches = { dayMatches: [[
    { a: 'FRA', b: 'IRQ', ko: '2026-06-22T21:00:00Z' },           // live (30m in)
    { a: 'ESP', b: 'GER', ko: '2026-06-22T18:40:00Z' },           // ended ~20m ago → cooldown
  ]] };
  const ctx = liveContext({ now, matches, matchMin: 150, cooldownMin: 30 });
  assert.strictEqual(ctx.phases.FRA, 'live');
  assert.strictEqual(ctx.phases.ESP, 'cooldown');
  assert.strictEqual(ctx.phase, 'live', 'overall phase is the hottest');
});
check('counts: computeTrend reads rising / steady / falling', () => {
  assert.ok(computeTrend([{ tweet_count: 5 }, { tweet_count: 5 }, { tweet_count: 50 }]).trend > 0.3, 'rising');
  assert.strictEqual(computeTrend([{ tweet_count: 10 }, { tweet_count: 10 }, { tweet_count: 10 }]).trend, 0, 'steady');
  assert.ok(computeTrend([{ tweet_count: 50 }, { tweet_count: 50 }, { tweet_count: 2 }]).trend < -0.3, 'falling');
  assert.strictEqual(computeTrend([]).trend, 0, 'no data → flat');
});
check('counts: computeTrend also yields free peak/current/minutes from the series', () => {
  const s = computeTrend([{ tweet_count: 8 }, { tweet_count: 40 }, { tweet_count: 12 }]);
  assert.strictEqual(s.peak, 40, 'peak = busiest minute');
  assert.strictEqual(s.current, 12, 'current = latest minute');
  assert.deepStrictEqual(s.minutes, [8, 40, 12], 'raw per-minute series for a sparkline');
  const empty = computeTrend([]);
  assert.strictEqual(empty.peak, 0);
  assert.deepStrictEqual(empty.minutes, []);
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

// Fake fetch whose body reader yields the given string chunks, then EOF.
function fakeStreamFetch(chunks, { onCancel } = {}) {
  const enc = new TextEncoder();
  let i = 0;
  return async () => ({
    ok: true,
    headers: { get: () => null },
    body: {
      getReader: () => ({
        read: async () =>
          i < chunks.length ? { value: enc.encode(chunks[i++]), done: false } : { value: undefined, done: true },
        cancel: async () => { if (onCancel) onCancel(); },
      }),
    },
  });
}

check('stream: parses NDJSON posts and skips blank keep-alives', async () => {
  process.env.X_BEARER_TOKEN = 'test';
  const post = { data: { id: '9' }, matching_rules: [{ tag: 'BRA' }] };
  global.fetch = fakeStreamFetch(['\n', JSON.stringify(post) + '\n']); // keep-alive, then a post
  const got = [];
  await streamPosts((p) => got.push(p), {});
  assert.strictEqual(got.length, 1, 'one post delivered; blank keep-alive ignored');
  assert.strictEqual(got[0].data.id, '9');
  delete global.fetch; delete process.env.X_BEARER_TOKEN;
});
check('stream: reassembles a post split across chunks', async () => {
  process.env.X_BEARER_TOKEN = 'test';
  const line = JSON.stringify({ data: { id: '42' } });
  global.fetch = fakeStreamFetch([line.slice(0, 10), line.slice(10) + '\n']); // split mid-line
  const got = [];
  await streamPosts((p) => got.push(p), {});
  assert.strictEqual(got.length, 1, 'split line reassembled into one post');
  assert.strictEqual(got[0].data.id, '42');
  delete global.fetch; delete process.env.X_BEARER_TOKEN;
});
check('stream: a silent connection trips the stall watchdog and frees the slot', async () => {
  process.env.X_BEARER_TOKEN = 'test';
  let cancelled = false;
  global.fetch = async () => ({
    ok: true,
    headers: { get: () => null },
    body: { getReader: () => ({ read: () => new Promise(() => {}), cancel: async () => { cancelled = true; } }) },
  });
  let threw = null;
  await streamPosts(() => {}, { stallMs: 40 }).catch((e) => { threw = e; });
  assert.ok(threw && threw.stall, 'stalled stream rejects with a .stall error');
  assert.ok(cancelled, 'reader cancelled so X’s single connection slot is released');
  delete global.fetch; delete process.env.X_BEARER_TOKEN;
});
check('stream: non-OK status rejects with .status and rate-limit hints', async () => {
  process.env.X_BEARER_TOKEN = 'test';
  global.fetch = async () => ({
    ok: false,
    status: 429,
    headers: { get: (h) => (h === 'x-rate-limit-reset' ? String(Math.floor(Date.now() / 1000) + 60) : null) },
    text: async () => 'Too Many Requests',
  });
  let threw = null;
  await streamPosts(() => {}, {}).catch((e) => { threw = e; });
  assert.strictEqual(threw && threw.status, 429);
  assert.ok(threw.rateLimitResetMs > Date.now(), 'captures x-rate-limit-reset for the backoff');
  delete global.fetch; delete process.env.X_BEARER_TOKEN;
});

check('stream: postWeight scales with engagement, bounded [1, 8]', () => {
  assert.strictEqual(postWeight({}), 1, 'no metrics → base weight 1');
  assert.strictEqual(postWeight({ public_metrics: { like_count: 0 } }), 1, 'zero engagement → 1');
  const low = postWeight({ public_metrics: { like_count: 9 } });
  const mid = postWeight({ public_metrics: { like_count: 999 } });
  assert.ok(low > 1 && low < mid, 'more engagement → more weight');
  const viral = postWeight({ public_metrics: { like_count: 1e9, retweet_count: 1e9 } });
  assert.ok(viral <= 8, 'mega-viral post is capped at 8, not unbounded');
  assert.ok(viral >= mid, 'monotonic');
});

check('trends: parseTrends maps the response and tags World-Cup trends', () => {
  const out = parseTrends({ data: [
    { trend_name: '#WorldCup2026', tweet_count: 50000 },
    { trend_name: 'Argentina', tweet_count: 12000 },
    { trend_name: 'Taylor Swift', tweet_count: 9000 },
    { trend_name: 'no count here' },
  ] });
  assert.strictEqual(out.length, 4);
  assert.deepStrictEqual(out[0], { name: '#WorldCup2026', postCount: 50000, wc: true });
  assert.strictEqual(out[1].wc, true, 'a nation name is a WC trend');
  assert.strictEqual(out[2].wc, false, 'unrelated trend is not WC');
  assert.strictEqual(out[3].postCount, 0, 'missing count → 0');
  assert.deepStrictEqual(parseTrends({}), [], 'no data → empty');
});
check('trends: isWorldCupTrend recognizes nations, codes, and keywords', () => {
  assert.ok(isWorldCupTrend('Brazil'));
  assert.ok(isWorldCupTrend('#FIFA'));
  assert.ok(isWorldCupTrend('the world cup final'));
  assert.ok(!isWorldCupTrend('#Eurovision'));
  assert.ok(!isWorldCupTrend(''));
});
check('trends: poller respects the daily cap (circuit breaker)', async () => {
  process.env.X_BEARER_TOKEN = 'test';
  process.env.X_TRENDS_DAILY_CAP = '1'; // below the 2-location count → can't finish
  let calls = 0;
  global.fetch = async () => { calls++; return { ok: true, json: async () => ({ data: [{ trend_name: 'X', tweet_count: 1 }] }) }; };
  const poller = createTrendsPoller({ log: { warn() {}, error() {} }, woeids: [{ woeid: 1, name: 'A' }, { woeid: 2, name: 'B' }] });
  await poller.cycle();
  assert.strictEqual(calls, 0, 'no requests when the cycle would exceed the cap');
  assert.strictEqual(poller.stats().capped, true);
  delete global.fetch; delete process.env.X_BEARER_TOKEN; delete process.env.X_TRENDS_DAILY_CAP;
});

// --- Trends → ambient globe glow ---------------------------------------------
check('trends: codeForTrend attributes a trend to the most specific nation', () => {
  assert.strictEqual(codeForTrend('#BRA'), 'BRA');
  assert.strictEqual(codeForTrend('Vamos Brasil!'), 'BRA');
  assert.strictEqual(codeForTrend('South Korea fighting'), 'KOR'); // longest match wins over "Korea"
  assert.strictEqual(codeForTrend('just some random topic'), null);
});
check('trends: trendsToAmbient yields a capped, normalized per-nation floor', () => {
  const locations = [{ trends: [
    { name: '#BRA', postCount: 100000, wc: true },
    { name: 'Argentina', postCount: 25000, wc: true },
    { name: 'taylor swift', postCount: 999999, wc: false }, // not WC → ignored
  ] }];
  const floor = trendsToAmbient(locations, 0.3);
  assert.ok(floor.BRA === 0.3, 'busiest WC nation pinned to the cap');
  assert.ok(floor.ARG > 0 && floor.ARG < 0.3, 'quieter nation gets a lower floor');
  assert.ok(!('TSWIFT' in floor) && Object.keys(floor).length === 2, 'non-WC trends excluded');
});
check('trends: poller feeds the engine ambient channel (zero extra requests)', async () => {
  process.env.X_BEARER_TOKEN = 'test';
  let got = null;
  const engine = { state: { BRA: {}, ARG: {} }, setAmbient(m) { got = m; } };
  global.fetch = async () => ({ ok: true, json: async () => ({ data: [{ trend_name: '#BRA', tweet_count: 5000 }] }) });
  const poller = createTrendsPoller({ engine, log: { warn() {}, error() {} }, woeids: [{ woeid: 1, name: 'A' }] });
  await poller.cycle();
  assert.ok(got && got.BRA > 0, 'a trending nation lights up the ambient channel');
  assert.strictEqual(poller.stats().ambientCount, 1);
  delete global.fetch; delete process.env.X_BEARER_TOKEN;
});

// --- Activity-adaptive cadence -----------------------------------------------
check('counts: liveDelay flexes fast↔calm by activity, knockouts always fast', () => {
  const fast = 60_000, calm = 150_000;
  assert.strictEqual(liveDelay(0, false, fast, calm), calm, 'flat match → calm ceiling');
  assert.strictEqual(liveDelay(1, false, fast, calm), fast, 'rising surge → fast floor');
  const mid = liveDelay(0.5, false, fast, calm);
  assert.ok(mid > fast && mid < calm, 'mid activity interpolates');
  assert.strictEqual(liveDelay(0, true, fast, calm), fast, 'knockout always polls fast');
});
check('counts: isKnockout distinguishes group letters from bracket labels', () => {
  // Groups are single letters A–L; knockout rounds use multi-char labels.
  assert.strictEqual(isKnockout('A'), false);
  assert.strictEqual(isKnockout('L'), false);
  assert.strictEqual(isKnockout('R32'), true);
  assert.strictEqual(isKnockout('R16'), true);
  assert.strictEqual(isKnockout('QF'), true);
  assert.strictEqual(isKnockout('SF'), true);
  // A single-letter final 'F' is indistinguishable from group F by label alone;
  // it reads as a group here (a buzzing final still polls fast via the activity
  // adapter). The bracket data should use a multi-char label like 'FIN' to force it.
  assert.strictEqual(isKnockout('FIN'), true);
});
check('counts: liveContext flags a live knockout match (koLive)', () => {
  const now = Date.parse('2026-07-10T21:30:00Z');
  const groups = liveContext({ now, matchMin: 150, matches: { dayMatches: [[
    { a: 'FRA', b: 'IRQ', g: 'C', ko: '2026-07-10T21:00:00Z' },
  ]] } });
  assert.strictEqual(groups.koLive, false, 'group match → not knockout');
  const ko = liveContext({ now, matchMin: 150, matches: { dayMatches: [[
    { a: 'FRA', b: 'IRQ', g: 'QF', ko: '2026-07-10T21:00:00Z' },
  ]] } });
  assert.strictEqual(ko.koLive, true, 'quarter-final → knockout');
});
check('counts: a rising live match raises liveActivity', async () => {
  process.env.X_BEARER_TOKEN = 'test';
  process.env.X_COUNTS_PULSE_DISABLED = '1';
  global.fetch = async () => ({ ok: true, headers: { get: () => null }, json: async () => ({
    meta: { total_tweet_count: 60 }, data: [{ tweet_count: 5 }, { tweet_count: 5 }, { tweet_count: 50 }] }) });
  const engine = { state: { BRA: {} }, setSignals() {}, surge() {} };
  const poller = createCountsPoller({ engine, log: { warn() {}, error() {} }, context: () => ({ codes: ['BRA'], phase: 'live', phases: { BRA: 'live' } }) });
  await poller.cycle();
  assert.ok(poller.stats().liveActivity > 0.3, 'a sharp minute-over-minute jump reads as lively');
  delete global.fetch; delete process.env.X_BEARER_TOKEN; delete process.env.X_COUNTS_PULSE_DISABLED;
});

check('counts: absoluteScale dims by tournament volume, floored and never inflating', () => {
  assert.strictEqual(absoluteScale(null, 0), 1, 'no pulse yet → no scaling');
  assert.strictEqual(absoluteScale(100, 0), 1, 'no peak yet → no scaling');
  assert.strictEqual(absoluteScale(300, 300), 1, 'at the peak → full glow');
  assert.ok(Math.abs(absoluteScale(150, 600) - 0.5) < 1e-9, 'quarter volume → sqrt → 0.5');
  assert.strictEqual(absoluteScale(10, 300), 0.35, 'very quiet → floored at 0.35');
  assert.strictEqual(absoluteScale(0, 300), 0.35, 'zero volume → still floored, never dark');
  assert.strictEqual(absoluteScale(400, 300), 1, 'total>peak (out of order) clamped to 1, never inflates');
});
check('counts: decayPeak lets a new high win but bleeds a stale blockbuster down', () => {
  assert.strictEqual(decayPeak(0, 500, 0.98), 500, 'first sample sets the peak');
  assert.strictEqual(decayPeak(500, 900, 0.98), 900, 'a fresh high wins immediately');
  assert.ok(Math.abs(decayPeak(500, 100, 0.98) - 490) < 1e-9, 'no new high → old peak decays by the factor');
  // A blockbuster peak must recalibrate toward sustained lower volume over time,
  // so the board recovers instead of being dimmed forever.
  let peak = 100000; // a past final
  for (let i = 0; i < 400; i++) peak = decayPeak(peak, 2000, 0.98); // a long quiet stretch
  assert.ok(peak <= 2000 + 1e-6, `stale peak bled down to recent volume (got ${Math.round(peak)})`);
  assert.strictEqual(decayPeak(NaN, NaN, 0.98), 0, 'NaN inputs → 0, never NaN');
});
check('counts: an idle cycle resets liveActivity (no stale carry-over)', async () => {
  process.env.X_BEARER_TOKEN = 'test';
  process.env.X_COUNTS_PULSE_DISABLED = '1';
  global.fetch = async () => ({ ok: true, headers: { get: () => null }, json: async () => ({
    meta: { total_tweet_count: 60 }, data: [{ tweet_count: 5 }, { tweet_count: 5 }, { tweet_count: 50 }] }) });
  const engine = { state: { BRA: {} }, setSignals() {}, surge() {} };
  let phase = 'live';
  const poller = createCountsPoller({ engine, log: { warn() {}, error() {} },
    context: () => (phase === 'live' ? { codes: ['BRA'], phase: 'live', phases: { BRA: 'live' } } : { codes: [], phase: 'idle', phases: {} }) });
  await poller.cycle();
  assert.ok(poller.stats().liveActivity > 0.3, 'lively while a match is live');
  phase = 'idle';
  await poller.cycle();
  assert.strictEqual(poller.stats().liveActivity, 0, 'idle cycle clears the stale activity');
  delete global.fetch; delete process.env.X_BEARER_TOKEN; delete process.env.X_COUNTS_PULSE_DISABLED;
});

check('counts: a cycle error during a live match retries on the live tier, not idle', async () => {
  process.env.X_BEARER_TOKEN = 'test';
  global.fetch = async () => { throw new Error('network blip'); };
  const engine = { state: { BRA: {} }, setSignals() {}, surge() {} };
  const ac = new AbortController();
  const poller = createCountsPoller({ engine, log: { warn() {}, error() {} },
    context: () => ({ codes: ['BRA'], phase: 'live', phases: { BRA: 'live' }, koLive: false }) });
  poller.start(ac.signal);
  await new Promise((r) => setTimeout(r, 30)); // let the first tick run and throw
  ac.abort();
  const s = poller.stats();
  assert.ok(s.errors > 0, 'the fetch error was recorded');
  assert.ok(s.nextDelayMs >= 60_000 && s.nextDelayMs <= 150_000,
    `error during a live match retries on the live band, not the 10m idle tier (got ${s.nextDelayMs})`);
  delete global.fetch; delete process.env.X_BEARER_TOKEN;
});

// --- Tournament-wide pulse ---------------------------------------------------
check('counts: tournament pulse fires once per slow tier while live, off when idle', async () => {
  process.env.X_BEARER_TOKEN = 'test';
  const queries = [];
  global.fetch = async (url) => {
    queries.push(decodeURIComponent(String(url)));
    return { ok: true, headers: { get: () => null }, json: async () => ({ meta: { total_tweet_count: 200 }, data: [{ tweet_count: 100 }, { tweet_count: 100 }] }) };
  };
  const engine = { state: { BRA: {} }, setSignals() {}, surge() {} };
  const poller = createCountsPoller({ engine, log: { warn() {}, error() {} }, context: () => ({ codes: ['BRA'], phase: 'live', phases: { BRA: 'live' } }) });
  await poller.cycle();
  const pulses = queries.filter((q) => !q.includes('"Brazil"')).length;
  assert.strictEqual(pulses, 1, 'exactly one tournament-wide pulse on the first live cycle');
  assert.strictEqual(poller.stats().tournamentTotal, 200, 'pulse total surfaced in stats');
  // Idle cycle issues no requests at all (pulse included).
  const before = queries.length;
  const idle = createCountsPoller({ engine, log: { warn() {}, error() {} }, context: () => ({ codes: [], phase: 'idle', phases: {} }) });
  await idle.cycle();
  assert.strictEqual(queries.length, before, 'no pulse (or any request) when nothing is live');
  delete global.fetch; delete process.env.X_BEARER_TOKEN;
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
