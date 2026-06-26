'use strict';

/**
 * Unit tests for the bracket projector's pure logic + cost gating — no network
 * (the Anthropic client is stubbed). Runs in CI via `npm test`.
 */

const assert = require('node:assert');
const { detectPhase, resolveBracket, buildProjection, parseAi, createProjector, ROUNDS } = require('./project');

let passed = 0;
const checks = [];
function check(name, fn) { checks.push({ name, fn }); }

function stubClient(json) {
  const state = { calls: 0 };
  return { state, messages: { create: async () => { state.calls++; return { content: [{ type: 'text', text: typeof json === 'string' ? json : JSON.stringify(json) }] }; } } };
}

// 72 group fixtures, all FT, plus knockout rounds we can dial in.
function makeMatches({ groupFT = 72, r32FT = 0 } = {}) {
  const day = [];
  for (let i = 0; i < 72; i++) day.push({ g: 'A', a: 'MEX', b: 'RSA', as: 1, bs: 0, st: i < groupFT ? 'FT' : 'UP' });
  for (let i = 0; i < 16; i++) day.push({ g: 'R32', a: 'ESP', b: 'AUT', as: 1, bs: 0, st: i < r32FT ? 'FT' : 'UP' });
  return { dayMatches: [day] };
}

check('detectPhase: group while group ties remain', () => {
  assert.strictEqual(detectPhase(makeMatches({ groupFT: 50 })), 'group');
});
check('detectPhase: r32 once groups are complete but R32 is not', () => {
  assert.strictEqual(detectPhase(makeMatches({ groupFT: 72, r32FT: 0 })), 'r32');
  assert.strictEqual(detectPhase(makeMatches({ groupFT: 72, r32FT: 8 })), 'r32');
});
check('detectPhase: advances to r16 when R32 is complete', () => {
  assert.strictEqual(detectPhase(makeMatches({ groupFT: 72, r32FT: 16 })), 'r16');
});
check('detectPhase: empty data is treated as group (nothing decided)', () => {
  assert.strictEqual(detectPhase({ dayMatches: [] }), 'group');
});

check('resolveBracket: top seed (ESP) is the projected champion', () => {
  const b = resolveBracket();
  assert.strictEqual(b.champ, 'ESP');
  assert.ok([b.final.a, b.final.b].includes('ESP'));
});

check('buildProjection: ranking fallback has all 5 rounds + champion', () => {
  const p = buildProjection({ matches: makeMatches({ groupFT: 40 }), phase: 'group' });
  assert.strictEqual(p.source, 'ranking');
  assert.strictEqual(p.champion, 'ESP');
  assert.strictEqual(p.rounds.length, ROUNDS.length);
  assert.deepStrictEqual(p.rounds.map((r) => r.round), ['R32', 'R16', 'QF', 'SF', 'F']);
  assert.ok(p.rounds.every((r) => r.note && r.note.length > 0), 'every round has a note');
});

check('buildProjection: round notes are distinct (not copy-paste)', () => {
  const p = buildProjection({ matches: makeMatches(), phase: 'r32' });
  const notes = new Set(p.rounds.map((r) => r.note));
  assert.strictEqual(notes.size, p.rounds.length, 'each round reads differently');
});

check('parseAi: extracts a JSON object with rounds, rejects junk', () => {
  assert.ok(parseAi('noise {"headline":"h","rounds":{"R32":"a"}} tail'));
  assert.strictEqual(parseAi('no json here'), null);
  assert.strictEqual(parseAi('{"headline":"h"}'), null, 'requires rounds');
});

check('projector: AI reply produces an ai-sourced projection', async () => {
  const c = stubClient({ headline: 'H', finalScore: '3-2', rounds: { R32: 'a', R16: 'b', QF: 'c', SF: 'd', F: 'e' } });
  const proj = createProjector({ client: c, log: { warn() {} } });
  const p = await proj.project({ matches: makeMatches({ groupFT: 72, r32FT: 0 }) });
  assert.strictEqual(c.state.calls, 1);
  assert.strictEqual(p.source, 'ai');
  assert.strictEqual(p.headline, 'H');
  assert.strictEqual(p.finalScore, '3-2');
  assert.strictEqual(p.rounds.find((r) => r.round === 'R32').note, 'a');
});

check('projector: unchanged phase reuses the prior AI projection (no new call)', async () => {
  const c = stubClient({ headline: 'H', rounds: { R32: 'a', R16: 'b', QF: 'c', SF: 'd', F: 'e' } });
  const proj = createProjector({ client: c, log: { warn() {} } });
  const matches = makeMatches({ groupFT: 72, r32FT: 0 }); // phase r32
  const first = await proj.project({ matches });
  const again = await proj.project({ matches, prevProjection: first });
  assert.strictEqual(c.state.calls, 1, 'same phase → no second LLM call');
  assert.ok(again.reused, 'prior projection reused');
});

check('projector: phase change spends a fresh call', async () => {
  const c = stubClient({ headline: 'H', rounds: { R32: 'a', R16: 'b', QF: 'c', SF: 'd', F: 'e' } });
  const proj = createProjector({ client: c, log: { warn() {} } });
  const first = await proj.project({ matches: makeMatches({ groupFT: 72, r32FT: 0 }) }); // r32
  await proj.project({ matches: makeMatches({ groupFT: 72, r32FT: 16 }), prevProjection: first }); // r16
  assert.strictEqual(c.state.calls, 2, 'new phase → new LLM call');
});

check('projector: degrades to template when AI reply is unreadable', async () => {
  const c = stubClient('not json');
  const proj = createProjector({ client: c, log: { warn() {} } });
  const p = await proj.project({ matches: makeMatches({ groupFT: 40 }) });
  assert.strictEqual(p.source, 'ranking', 'falls back to the data template');
});

check('projector: no client → template, no crash', async () => {
  const proj = createProjector({ log: { warn() {} } });
  const p = await proj.project({ matches: makeMatches({ groupFT: 40 }) });
  assert.strictEqual(p.source, 'ranking');
});

(async () => {
  for (const { name, fn } of checks) {
    try { await fn(); passed++; console.log('  ✅ ' + name); }
    catch (err) { console.error('  ❌ ' + name + ' — ' + err.message); process.exitCode = 1; }
  }
  if (process.exitCode) console.error('\nproject-self-test FAILED');
  else console.log(`\nproject-self-test passed (${passed} checks)`);
})();
