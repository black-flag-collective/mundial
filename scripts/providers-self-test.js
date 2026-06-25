'use strict';

/**
 * Unit tests for the pluggable data-source providers — no network, no real AI
 * call (fetch and the Anthropic client are stubbed). Runs in CI via `npm test`.
 *
 * Covers: pure helpers, team-code mapping (the main new risk), the sports-API
 * fixture mapping, the chain-of-responsibility runner, and graceful skip on a
 * 400 credit-balance / 429 rate-limit error (the bug that turned the Action red).
 */

const assert = require('node:assert');

const { TEAM_CODES, CODE_SET, toFifa } = require('./providers/team-codes');
const { toDayShort, toDayLong, toDow, mapStatus, normalizeGroup, mapStage, demotePrematureResults } = require('./providers/provider');
const { createSportsApiProvider, mapFixtures } = require('./providers/sports-api');
const { createClaudeProvider } = require('./providers/claude-search');
const { runProviders, hasContent } = require('./providers/runner');
const { mergeUpdate } = require('./update-data');

let passed = 0;
const checks = [];
function check(name, fn) { checks.push({ name, fn }); }

const SILENT = { log() {}, warn() {}, error() {} };

// ---- pure helpers -----------------------------------------------------------

check('provider: toDayShort/Long/Dow group by US-Eastern matchday', () => {
  assert.strictEqual(toDayShort('2026-06-19T18:00:00Z'), 'Jun 19'); // 2pm ET
  assert.strictEqual(toDayLong('2026-06-19T18:00:00Z'), 'June 19');
  assert.strictEqual(toDow('2026-06-19T18:00:00Z'), 'Friday');
  // A kickoff after midnight UTC belongs to the prior Eastern matchday:
  // 02:00Z Jun 26 = 10pm ET Jun 25 (Thursday) — not Jun 26.
  assert.strictEqual(toDayShort('2026-06-26T02:00:00Z'), 'Jun 25');
  assert.strictEqual(toDow('2026-06-26T02:00:00Z'), 'Thursday');
  assert.strictEqual(toDayShort('not-a-date'), null);
});

check('provider: demotePrematureResults — no result before kickoff', () => {
  const now = Date.parse('2026-06-25T18:00:00Z');
  const data = { dayMatches: [[
    { g: 'A', a: 'BRA', b: 'ENG', as: 2, bs: 1, st: 'FT', ko: '2026-06-25T15:00:00Z' }, // past → keep
    { g: 'B', a: 'ECU', b: 'GER', as: 0, bs: 2, st: 'FT', ko: '2026-06-25T20:00:00Z' }, // future FT → reset
    { g: 'C', a: 'JPN', b: 'SWE', as: 1, bs: 1, st: 'LIVE', ko: '2026-06-26T02:00:00Z' }, // future LIVE → reset
    { g: 'D', a: 'USA', b: 'TUR', st: 'UP', ko: '2026-06-27T00:00:00Z' }, // already UP → untouched
    { round: 'F', a: 'ARG', b: 'FRA', as: 3, bs: 2, st: 'FT' }, // no ko → can't verify → keep
  ]] };
  const reset = demotePrematureResults(data, now);
  assert.strictEqual(reset, 2, 'only the two future FT/LIVE entries reset');
  const [past, fut1, fut2, up, noko] = data.dayMatches[0];
  assert.strictEqual(past.st, 'FT'); assert.strictEqual(past.as, 2);
  assert.strictEqual(fut1.st, 'UP'); assert.ok(!('as' in fut1) && !('bs' in fut1), 'future score dropped');
  assert.strictEqual(fut2.st, 'UP'); assert.ok(!('as' in fut2));
  assert.strictEqual(up.st, 'UP');
  assert.strictEqual(noko.st, 'FT', 'no ko → left as-is');
});

check('provider: mapStatus normalizes API statuses to FT/LIVE/UP', () => {
  assert.strictEqual(mapStatus('FINISHED'), 'FT');
  assert.strictEqual(mapStatus('AET'), 'FT');
  assert.strictEqual(mapStatus('IN_PLAY'), 'LIVE');
  assert.strictEqual(mapStatus('PAUSED'), 'LIVE');
  assert.strictEqual(mapStatus('TIMED'), 'UP');
  assert.strictEqual(mapStatus('SCHEDULED'), 'UP');
  assert.strictEqual(mapStatus(undefined), 'UP');
});

check('provider: mapStage maps knockout stages to round codes; group stage → null', () => {
  assert.strictEqual(mapStage('LAST_16'), 'R16');
  assert.strictEqual(mapStage('ROUND_OF_16'), 'R16');
  assert.strictEqual(mapStage('QUARTER_FINALS'), 'QF');
  assert.strictEqual(mapStage('SEMI_FINALS'), 'SF');
  assert.strictEqual(mapStage('THIRD_PLACE'), '3P');
  assert.strictEqual(mapStage('FINAL'), 'F');
  assert.strictEqual(mapStage('GROUP_STAGE'), null);
  assert.strictEqual(mapStage(undefined), null);
});

check('provider: normalizeGroup extracts the letter', () => {
  assert.strictEqual(normalizeGroup('GROUP_A'), 'A');
  assert.strictEqual(normalizeGroup('Group L'), 'L');
  assert.strictEqual(normalizeGroup('C'), 'C');
  assert.strictEqual(normalizeGroup(null), null);
});

// ---- team-code mapping (the main new risk) ----------------------------------

check('team-codes: toFifa resolves abbreviations, aliases, and rejects unknowns', () => {
  assert.strictEqual(toFifa('BRA'), 'BRA', 'tla already a FIFA code');
  assert.strictEqual(toFifa('bra'), 'BRA', 'case-insensitive');
  assert.strictEqual(toFifa('ZZZ', 'South Africa'), 'RSA', 'falls back to name alias');
  assert.strictEqual(toFifa('Iran'), 'IRN', 'name alias');
  assert.strictEqual(toFifa('Saudi Arabia'), 'KSA');
  assert.strictEqual(toFifa('Atlantis', 'Wakanda'), null, 'unknown → null (dropped, never guessed)');
});

// ---- sports-API fixture mapping ---------------------------------------------

const FD_FIXTURES = [
  { // finished
    utcDate: '2026-06-19T19:00:00Z', status: 'FINISHED', group: 'GROUP_A',
    homeTeam: { tla: 'BRA', name: 'Brazil' }, awayTeam: { tla: 'MAR', name: 'Morocco' },
    score: { fullTime: { home: 3, away: 1 } },
  },
  { // upcoming
    utcDate: '2026-06-20T16:00:00Z', status: 'TIMED', group: 'GROUP_B',
    homeTeam: { tla: 'ESP', name: 'Spain' }, awayTeam: { tla: 'CPV', name: 'Cape Verde' },
    score: { fullTime: { home: null, away: null } },
  },
  { // unmappable away team → must be dropped
    utcDate: '2026-06-20T19:00:00Z', status: 'FINISHED', group: 'GROUP_B',
    homeTeam: { tla: 'ESP', name: 'Spain' }, awayTeam: { tla: 'ZZZ', name: 'Atlantis' },
    score: { fullTime: { home: 2, away: 0 } },
  },
];

check('sports-api: mapFixtures produces normalized shape and codes ⊆ TEAM_CODES', () => {
  const { new_days, updated_matches } = mapFixtures(FD_FIXTURES, SILENT);

  // unmappable fixture dropped → only the two valid days
  const allMatches = new_days.flatMap(d => d.matches);
  assert.strictEqual(allMatches.length, 2, 'unmappable fixture dropped');
  for (const m of allMatches) {
    assert.ok(CODE_SET.has(m.a) && CODE_SET.has(m.b), `${m.a}/${m.b} are FIFA codes`);
  }

  const finished = allMatches.find(m => m.a === 'BRA');
  assert.deepStrictEqual(
    { g: finished.g, st: finished.st, as: finished.as, bs: finished.bs },
    { g: 'A', st: 'FT', as: 3, bs: 1 },
  );
  assert.strictEqual(new_days.find(d => d.matches.some(m => m.a === 'BRA')).day_short, 'Jun 19');

  const up = allMatches.find(m => m.a === 'ESP');
  assert.strictEqual(up.st, 'UP');
  assert.ok(!('as' in up), 'upcoming match carries no score');

  // FT/LIVE fixtures also emitted as updated_matches (to patch existing UPs)
  assert.strictEqual(updated_matches.length, 1);
  assert.strictEqual(updated_matches[0].st, 'FT');
});

check('sports-api: a FINISHED/IN_PLAY fixture with missing scores never becomes a fake 0–0', () => {
  // football-data.org can report a FINISHED match with null fullTime scores.
  // It must NOT be written as FT 0–0 (mergeUpdate would then freeze it forever);
  // it stays UP until a real score arrives.
  const scoreless = [
    { utcDate: '2026-06-21T19:00:00Z', status: 'FINISHED', group: 'GROUP_A',
      homeTeam: { tla: 'GER', name: 'Germany' }, awayTeam: { tla: 'JPN', name: 'Japan' },
      score: { fullTime: { home: null, away: null } } },
    { utcDate: '2026-06-21T19:00:00Z', status: 'IN_PLAY', group: 'GROUP_C',
      homeTeam: { tla: 'FRA', name: 'France' }, awayTeam: { tla: 'SEN', name: 'Senegal' },
      score: {} },
  ];
  const { new_days, updated_matches } = mapFixtures(scoreless, SILENT);
  const all = new_days.flatMap(d => d.matches);
  assert.strictEqual(updated_matches.length, 0, 'no fabricated scores promoted');
  for (const m of all) {
    assert.strictEqual(m.st, 'UP', 'scoreless match kept UP');
    assert.ok(!('as' in m) && !('bs' in m), 'no fake 0–0 written');
  }
});

check('sports-api: knockout ties carry a round (not a group); FINAL never becomes Group L', () => {
  // WC2026 groups run A–L, so "FINAL" must NOT normalize to the real Group L —
  // knockout ties are emitted with a `round` code and never a group letter.
  const knockout = [
    { utcDate: '2026-07-19T19:00:00Z', status: 'FINISHED', stage: 'FINAL', // no group
      homeTeam: { tla: 'BRA', name: 'Brazil' }, awayTeam: { tla: 'FRA', name: 'France' },
      score: { fullTime: { home: 2, away: 1 } } },
    { utcDate: '2026-07-11T19:00:00Z', status: 'TIMED', stage: 'QUARTER_FINALS',
      homeTeam: { tla: 'ESP', name: 'Spain' }, awayTeam: { tla: 'GER', name: 'Germany' },
      score: {} },
  ];
  const { new_days, updated_matches } = mapFixtures(knockout, SILENT);
  const all = new_days.flatMap(d => d.matches);
  assert.strictEqual(all.length, 2, 'both knockout ties emitted');
  for (const m of all) {
    assert.ok(m.round && !('g' in m), `${m.a}-${m.b} carries a round, not a group`);
    assert.notStrictEqual(m.round, 'L', 'FINAL must not become Group L');
  }
  const final = all.find(m => m.round === 'F');
  assert.ok(final && final.st === 'FT' && final.as === 2 && final.bs === 1, 'final has its real score');
  assert.strictEqual(all.find(m => m.round === 'QF').st, 'UP', 'scoreless QF kept UP');
  assert.strictEqual(updated_matches.length, 1, 'only the finished final is a score update');
  assert.strictEqual(updated_matches[0].round, 'F', 'update carries the round context');
});

check('sports-api: a knockout rematch of group opponents is NOT deduped against the group tie', () => {
  // Two teams that met in the group can meet again in a knockout tie. The
  // fixture key must include the round/group context so the rematch survives.
  const current = { days: [{ short: 'Jun 11', long: 'June 11', dow: 'Thursday' }],
    dayMatches: [[{ g: 'A', a: 'BRA', b: 'FRA', as: 1, bs: 1, st: 'FT' }]] };
  const update = { new_days: [{ day_short: 'Jul 19', day_long: 'July 19', day_dow: 'Sunday',
    matches: [{ round: 'F', a: 'BRA', b: 'FRA', st: 'UP' }] }], updated_matches: [] };
  const { data, changed } = mergeUpdate(current, update);
  assert.ok(changed, 'the knockout rematch is added');
  const all = data.dayMatches.flat();
  assert.strictEqual(all.filter(m => m.a === 'BRA' && m.b === 'FRA').length, 2, 'group tie + knockout rematch both present');
});

check('team-codes: RKS (Kosovo) is NOT mapped to KSA (never guess)', () => {
  // Saudi Arabia resolves directly via its FIFA code; Kosovo must not be
  // silently misclassified as Saudi Arabia.
  assert.strictEqual(toFifa('KSA'), 'KSA');
  assert.strictEqual(toFifa('RKS'), null, 'unknown/ambiguous token drops, never guesses');
});

check('sports-api: provider isAvailable gates on token + fetch', () => {
  assert.strictEqual(createSportsApiProvider({ token: '', fetch: () => {} }).isAvailable(), false);
  assert.strictEqual(createSportsApiProvider({ token: 'k', fetch: null }).isAvailable(), false);
  assert.strictEqual(createSportsApiProvider({ token: 'k', fetch: () => {} }).isAvailable(), true);
});

check('sports-api: fetchUpdate maps a successful HTTP response', async () => {
  const fakeFetch = async () => ({ ok: true, status: 200, json: async () => ({ matches: FD_FIXTURES }) });
  const p = createSportsApiProvider({ token: 'k', fetch: fakeFetch, log: SILENT });
  const u = await p.fetchUpdate();
  assert.ok(hasContent(u));
  assert.strictEqual(u.updated_matches.length, 1);
});

check('sports-api: HTTP error or fetch throw → null (chain falls through)', async () => {
  const httpErr = createSportsApiProvider({ token: 'k', log: SILENT, fetch: async () => ({ ok: false, status: 429 }) });
  assert.strictEqual(await httpErr.fetchUpdate(), null);
  const threw = createSportsApiProvider({ token: 'k', log: SILENT, fetch: async () => { throw new Error('ECONNRESET'); } });
  assert.strictEqual(await threw.fetchUpdate(), null);
});

// ---- Claude fallback provider: graceful skip --------------------------------

function stubClientThrowing(status, message) {
  return { messages: { create: async () => { const e = new Error(message); e.status = status; throw e; } } };
}

check('claude: 400 credit-balance-too-low → null, never throws (the red-Action bug)', async () => {
  const client = stubClientThrowing(400, 'Your credit balance is too low to access the Anthropic API.');
  const p = createClaudeProvider({ client, log: SILENT });
  const data = { days: [{ short: 'Jun 18' }], dayMatches: [[]] };
  assert.strictEqual(await p.fetchUpdate(data), null);
});

check('claude: persistent 429 → null', async () => {
  const client = stubClientThrowing(429, 'rate limited');
  const p = createClaudeProvider({ client, log: SILENT });
  const data = { days: [{ short: 'Jun 18' }], dayMatches: [[]] };
  assert.strictEqual(await p.fetchUpdate(data), null);
});

check('claude: a non-skippable error still throws (real failures stay visible)', async () => {
  const client = stubClientThrowing(500, 'internal error');
  const p = createClaudeProvider({ client, log: SILENT });
  const data = { days: [{ short: 'Jun 18' }], dayMatches: [[]] };
  await assert.rejects(() => p.fetchUpdate(data), /internal error/);
});

check('claude: parses a <match_data> block into the normalized shape', async () => {
  const payload = { new_days: [], updated_matches: [{ day_short: 'Jun 18', a: 'SUI', b: 'BIH', as: 2, bs: 0, st: 'FT' }] };
  const client = { messages: { create: async () => ({ content: [{ type: 'text', text: `<match_data>${JSON.stringify(payload)}</match_data>` }] }) } };
  const p = createClaudeProvider({ client, log: SILENT });
  const data = { days: [{ short: 'Jun 18' }], dayMatches: [[]] };
  const u = await p.fetchUpdate(data);
  assert.strictEqual(u.updated_matches[0].a, 'SUI');
});

check('claude: isAvailable reflects whether a client was injected', () => {
  assert.strictEqual(createClaudeProvider({ client: null }).isAvailable(), false);
  assert.strictEqual(createClaudeProvider({ client: {} }).isAvailable(), true);
});

// ---- runner: chain-of-responsibility ----------------------------------------

function fakeProvider(name, { available = true, result, throws } = {}) {
  return {
    name,
    isAvailable: () => available,
    fetchUpdate: async () => { if (throws) throw new Error(throws); return result; },
  };
}

const SOME = { new_days: [], updated_matches: [{ day_short: 'Jun 18', a: 'SUI', b: 'BIH', as: 2, bs: 0, st: 'FT' }] };
const EMPTY = { new_days: [], updated_matches: [] };

check('runner: primary with content wins; fallback never consulted', async () => {
  let fbCalls = 0;
  const fb = { name: 'fb', isAvailable: () => true, fetchUpdate: async () => { fbCalls++; return SOME; } };
  const { update, provider } = await runProviders([fakeProvider('primary', { result: SOME }), fb], {}, { log: SILENT });
  assert.strictEqual(provider, 'primary');
  assert.ok(hasContent(update));
  assert.strictEqual(fbCalls, 0, 'fallback not called when primary delivered');
});

check('runner: primary empty-but-successful is authoritative (no billed fallback call)', async () => {
  let fbCalls = 0;
  const fb = { name: 'fb', isAvailable: () => true, fetchUpdate: async () => { fbCalls++; return SOME; } };
  const { update, provider } = await runProviders([fakeProvider('primary', { result: EMPTY }), fb], {}, { log: SILENT });
  assert.strictEqual(provider, 'primary');
  assert.strictEqual(hasContent(update), false);
  assert.strictEqual(fbCalls, 0, 'empty success stops the chain — fallback NOT called');
});

check('runner: null (could-not-run) falls through to the fallback', async () => {
  const { update, provider } = await runProviders(
    [fakeProvider('primary', { result: null }), fakeProvider('fb', { result: SOME })], {}, { log: SILENT },
  );
  assert.strictEqual(provider, 'fb');
  assert.ok(hasContent(update));
});

check('runner: a throwing provider is isolated; the next still runs', async () => {
  const { update, provider } = await runProviders(
    [fakeProvider('primary', { throws: 'boom' }), fakeProvider('fb', { result: SOME })], {}, { log: SILENT },
  );
  assert.strictEqual(provider, 'fb');
  assert.ok(hasContent(update));
});

check('runner: unavailable providers are skipped; none available → {null,null}', async () => {
  const { update, provider } = await runProviders(
    [fakeProvider('primary', { available: false }), fakeProvider('fb', { available: false })], {}, { log: SILENT },
  );
  assert.strictEqual(update, null);
  assert.strictEqual(provider, null);
});

// ---- run --------------------------------------------------------------------

(async () => {
  for (const { name, fn } of checks) {
    try { await fn(); passed++; console.log('  ✅ ' + name); }
    catch (err) { console.error('  ❌ ' + name + ' — ' + err.message); process.exitCode = 1; }
  }
  if (process.exitCode) console.error('\nproviders-self-test FAILED');
  else console.log(`\nproviders-self-test passed (${passed} checks)`);
})();
