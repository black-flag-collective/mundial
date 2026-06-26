'use strict';

/**
 * Bracket projection — a fresh, round-by-round read on how the knockouts will
 * unfold, regenerated at each tournament STAGE TRANSITION (group → R32 → R16 →
 * QF → SF → final) so there's a reason to come back to the site after each round.
 *
 * The projected WINNERS stay deterministic (world ranking, mirroring the client's
 * resolveBracket) so the narrative and the rendered bracket never disagree. The
 * round-by-round RATIONALE — the "why this is how it'll go, given the results so
 * far" — is written by a cheap LLM when ANTHROPIC_API_KEY is configured, and
 * degrades to a solid data-driven template otherwise.
 *
 * Cost is bounded by only ever firing the LLM when the phase actually advances
 * (createProjector.project reuses a same-phase AI projection untouched).
 *
 * Run directly to (re)write data/projection.json from data/matches.json:
 *   node scripts/project.js
 */

// World ranking + R32 seeding mirror the client (public/index.html this.rank /
// this.r32) — kept in lockstep so the projected champion matches the bracket UI.
const RANK = {
  ESP: 1, ARG: 2, FRA: 3, ENG: 4, BRA: 5, POR: 6, NED: 7, BEL: 8, GER: 9, CRO: 10,
  MAR: 11, COL: 12, URU: 13, USA: 14, SUI: 15, JPN: 16, SEN: 17, MEX: 18, ECU: 19, AUT: 20,
  AUS: 21, KOR: 22, IRN: 23, NOR: 24, EGY: 25, SWE: 26, PAN: 27, CIV: 28, TUR: 29, CAN: 30,
  QAT: 31, PAR: 32, SCO: 33, ALG: 34, TUN: 35, CZE: 36, GHA: 37, KSA: 38, IRQ: 39, JOR: 40,
  UZB: 41, COD: 42, BIH: 43, RSA: 44, NZL: 45, CPV: 46, CUW: 47, HAI: 48,
};
const R32_SEED = [
  ['GER', 'PAR'], ['FRA', 'SWE'], ['KOR', 'CAN'], ['NED', 'MAR'],
  ['COL', 'CRO'], ['ESP', 'AUT'], ['USA', 'BIH'], ['BEL', 'CZE'],
  ['BRA', 'JPN'], ['ECU', 'NOR'], ['MEX', 'SCO'], ['ENG', 'SEN'],
  ['ARG', 'URU'], ['TUR', 'EGY'], ['SUI', 'ALG'], ['POR', 'CIV'],
];
const NAME = {
  MEX: 'Mexico', RSA: 'South Africa', KOR: 'South Korea', CZE: 'Czechia', CAN: 'Canada',
  SUI: 'Switzerland', QAT: 'Qatar', BIH: 'Bosnia & Herzegovina', BRA: 'Brazil', MAR: 'Morocco',
  HAI: 'Haiti', SCO: 'Scotland', USA: 'United States', PAR: 'Paraguay', AUS: 'Australia',
  TUR: 'Türkiye', GER: 'Germany', CUW: 'Curaçao', ECU: 'Ecuador', NED: 'Netherlands',
  JPN: 'Japan', TUN: 'Tunisia', SWE: 'Sweden', BEL: 'Belgium', EGY: 'Egypt', IRN: 'Iran',
  NZL: 'New Zealand', ESP: 'Spain', CPV: 'Cabo Verde', KSA: 'Saudi Arabia', URU: 'Uruguay',
  FRA: 'France', SEN: 'Senegal', NOR: 'Norway', IRQ: 'Iraq', ARG: 'Argentina', ALG: 'Algeria',
  AUT: 'Austria', JOR: 'Jordan', POR: 'Portugal', UZB: 'Uzbekistan', COL: 'Colombia',
  COD: 'DR Congo', ENG: 'England', CRO: 'Croatia', GHA: 'Ghana', PAN: 'Panama',
};

// Knockout rounds in order, with how many ties each holds when complete.
const ROUNDS = [
  { key: 'R32', label: 'Round of 32', n: 16 },
  { key: 'R16', label: 'Round of 16', n: 8 },
  { key: 'QF', label: 'Quarter-finals', n: 4 },
  { key: 'SF', label: 'Semi-finals', n: 2 },
  { key: 'F', label: 'Final', n: 1 },
];
const PHASE_LABEL = {
  group: 'Group stage', r32: 'Round of 32', r16: 'Round of 16',
  qf: 'Quarter-finals', sf: 'Semi-finals', final: 'Final', done: 'Champions crowned',
};

const nameOf = (c) => NAME[c] || c;
const isGroupCode = (g) => /^[A-L]$/.test(String(g || ''));
const roundKey = (m) => m.round || (m.g && !isGroupCode(m.g) ? String(m.g).toUpperCase() : null);

/**
 * Current tournament phase from the live data (pure). 'group' until every group
 * tie is FT, then the first knockout round that isn't fully decided, else 'done'.
 */
function detectPhase(matches) {
  const days = (matches && matches.dayMatches) || [];
  let groupFT = 0, groupTotal = 0;
  const ftByRound = {};
  for (const day of days) {
    for (const m of day || []) {
      if (isGroupCode(m.g) && !m.round) { groupTotal++; if (m.st === 'FT') groupFT++; continue; }
      const r = roundKey(m);
      if (r) { (ftByRound[r] = ftByRound[r] || { ft: 0 }); if (m.st === 'FT') ftByRound[r].ft++; }
    }
  }
  if (groupTotal === 0 || groupFT < groupTotal) return 'group';
  for (const r of ROUNDS) {
    const ft = (ftByRound[r.key] || {}).ft || 0;
    if (ft < r.n) return r.key === 'F' ? 'final' : r.key.toLowerCase();
  }
  return 'done';
}

/** Per-team W-D-L-GF-GA from finished matches (pure). */
function summarizeResults(matches) {
  const rec = {};
  const bump = (c) => (rec[c] = rec[c] || { w: 0, d: 0, l: 0, gf: 0, ga: 0 });
  for (const day of (matches && matches.dayMatches) || []) {
    for (const m of day || []) {
      if (m.st !== 'FT' || m.as == null || m.bs == null) continue;
      const a = bump(m.a), b = bump(m.b);
      a.gf += m.as; a.ga += m.bs; b.gf += m.bs; b.ga += m.as;
      if (m.as > m.bs) { a.w++; b.l++; } else if (m.as < m.bs) { b.w++; a.l++; } else { a.d++; b.d++; }
    }
  }
  return rec;
}

/** Deterministic bracket by world ranking (mirror of client resolveBracket). */
function resolveBracket(rank = RANK, seed = R32_SEED) {
  const win = (a, b) => ((rank[a] ?? 99) <= (rank[b] ?? 99) ? a : b);
  const build = (prev) => {
    const out = [];
    for (let i = 0; i < prev.length; i += 2) { const a = prev[i].w, b = prev[i + 1].w; out.push({ a, b, w: win(a, b) }); }
    return out;
  };
  const r32 = seed.map((p) => ({ a: p[0], b: p[1], w: win(p[0], p[1]) }));
  const r16 = build(r32), qf = build(r16), sf = build(qf), final = build(sf);
  return { r32, r16, qf, sf, final: final[0], champ: final[0].w };
}

/** Compact, data-driven rationale for one round (the no-LLM fallback, pure). */
function templateNote(roundKey_, bracket, rec) {
  const gap = (t) => Math.abs((RANK[t.a] ?? 99) - (RANK[t.b] ?? 99));
  const closest = (ties) => ties.slice().sort((x, y) => gap(x) - gap(y))[0];
  const list = (ties) => ties.map((t) => nameOf(t.w)).join(', ');
  switch (roundKey_) {
    case 'R32': {
      const u = closest(bracket.r32);
      return `Seeds should mostly hold in the Round of 32; the tightest tie on paper is ${nameOf(u.a)} v ${nameOf(u.b)}, the likeliest upset.`;
    }
    case 'R16': {
      const u = closest(bracket.r16);
      return `The Round of 16 narrows the field — ${nameOf(u.a)} v ${nameOf(u.b)} is the tie most likely to buck the ranking.`;
    }
    case 'QF':
      return `Quarter-final weekend thins the contenders: ${list(bracket.qf)} are projected through to the semis.`;
    case 'SF':
      return `${list(bracket.sf)} are tipped to come out of the semi-finals and meet for the title.`;
    case 'F':
      return `${nameOf(bracket.final.a)} v ${nameOf(bracket.final.b)} — the two highest-ranked sides left; ${nameOf(bracket.champ)} edges it on pedigree.`;
    default:
      return 'Seeds hold serve.';
  }
}

/** Assemble a projection object from the deterministic bracket + optional AI text. */
function buildProjection({ matches, phase, ai = null, model = null } = {}) {
  const bracket = resolveBracket();
  const rec = summarizeResults(matches);
  const champ = bracket.champ;
  const runnerUp = bracket.final.a === champ ? bracket.final.b : bracket.final.a;
  const rounds = ROUNDS.map((r) => ({
    round: r.key,
    label: r.label,
    note: (ai && ai.rounds && ai.rounds[r.key]) ? String(ai.rounds[r.key]) : templateNote(r.key, bracket, rec),
  }));
  return {
    phase,
    phaseLabel: PHASE_LABEL[phase] || phase,
    generatedAt: new Date().toISOString(),
    source: ai ? 'ai' : 'ranking',
    model: ai ? (model || null) : null,
    champion: champ,
    championName: nameOf(champ),
    runnerUp,
    runnerUpName: nameOf(runnerUp),
    finalScore: (ai && ai.finalScore) ? String(ai.finalScore) : '2-1',
    headline: (ai && ai.headline) ? String(ai.headline)
      : `With the ${PHASE_LABEL[phase].toLowerCase()} ${phase === 'group' ? 'still unfolding' : 'decided'}, the seeding still points to ${nameOf(champ)} lifting the trophy over ${nameOf(runnerUp)}.`,
    rounds,
  };
}

const SYSTEM = [
  'You are a measured football analyst writing a short, fresh projection for a 2026',
  'World Cup bracket. You are given the current phase, results/form so far, and the',
  'ranking-projected path (champion, runner-up, and each knockout round\'s favourite).',
  'Keep the projected winners as given — do NOT change who advances. Write only the',
  'RATIONALE: a vivid one-sentence headline, and one grounded sentence per round',
  '(R32, R16, QF, SF, F) explaining why that round breaks the way it does given the',
  'form so far. Credible, specific, not outlandish. Respond with ONLY JSON, exactly:',
  '{"headline":"<sentence>","finalScore":"<e.g. 2-1>","rounds":{"R32":"<s>","R16":"<s>","QF":"<s>","SF":"<s>","F":"<s>"}}',
].join(' ');

/** Build the compact user content for the LLM (pure). */
function buildProjectionContext({ matches, phase }) {
  const bracket = resolveBracket();
  const rec = summarizeResults(matches);
  const form = Object.keys(rec)
    .sort((a, b) => (rec[b].w * 3 + rec[b].d) - (rec[a].w * 3 + rec[a].d)).slice(0, 12)
    .map((c) => `${nameOf(c)} ${rec[c].w}W-${rec[c].d}D-${rec[c].l}L`).join(', ');
  const fav = (ties) => ties.map((t) => nameOf(t.w)).join(', ');
  return [
    `Current phase: ${PHASE_LABEL[phase]}.`,
    `Results/form so far: ${form || 'no results yet'}.`,
    `Ranking-projected favourites — R32: ${fav(bracket.r32)}. R16: ${fav(bracket.r16)}. QF: ${fav(bracket.qf)}. SF: ${fav(bracket.sf)}. Final: ${nameOf(bracket.final.a)} vs ${nameOf(bracket.final.b)}, champion ${nameOf(bracket.champ)}.`,
    'Write the projection rationale now.',
  ].join('\n');
}

function parseAi(text) {
  if (!text) return null;
  const m = String(text).match(/\{[\s\S]*\}/);
  if (!m) return null;
  let o; try { o = JSON.parse(m[0]); } catch { return null; }
  if (!o || !o.rounds) return null;
  return o;
}

/**
 * Projector. `client` is an Anthropic SDK client (optional). project() returns a
 * projection object; it only spends an LLM call when the phase has advanced past
 * `prevProjection` — same-phase AI projections are returned untouched.
 */
function createProjector({ client, model = process.env.X_PROJECT_MODEL || 'claude-haiku-4-5', maxTokens = 420, log = console } = {}) {
  async function project({ matches, prevProjection = null } = {}) {
    const phase = detectPhase(matches);
    // No stage change since the last AI projection → reuse it (no new LLM spend).
    if (prevProjection && prevProjection.phase === phase && prevProjection.source === 'ai') {
      return { ...prevProjection, reused: true };
    }
    if (client) {
      try {
        const resp = await client.messages.create({
          model, max_tokens: maxTokens,
          system: [{ type: 'text', text: SYSTEM, cache_control: { type: 'ephemeral' } }],
          messages: [{ role: 'user', content: buildProjectionContext({ matches, phase }) }],
        });
        const text = (resp && Array.isArray(resp.content)) ? resp.content.map((b) => b.text || '').join('') : '';
        const ai = parseAi(text);
        if (ai) return buildProjection({ matches, phase, ai, model });
        log.warn && log.warn('[project] unreadable AI reply — using template');
      } catch (err) {
        log.warn && log.warn('[project] AI projection failed — using template:', err.message);
      }
    }
    return buildProjection({ matches, phase });
  }
  return { project };
}

module.exports = {
  RANK, R32_SEED, NAME, ROUNDS, PHASE_LABEL,
  detectPhase, summarizeResults, resolveBracket, buildProjection,
  buildProjectionContext, parseAi, createProjector, SYSTEM,
};

// CLI: regenerate data/projection.json from data/matches.json (used by the
// update cycle and runnable locally; falls back to the template with no API key).
if (require.main === module) {
  const fs = require('fs');
  const path = require('path');
  const dataDir = path.join(__dirname, '..', 'data');
  const matchesPath = path.join(dataDir, 'matches.json');
  const outPath = path.join(dataDir, 'projection.json');
  (async () => {
    const matches = JSON.parse(fs.readFileSync(matchesPath, 'utf8'));
    let prev = null;
    try { prev = JSON.parse(fs.readFileSync(outPath, 'utf8')); } catch { /* none yet */ }
    let client = null;
    if (process.env.ANTHROPIC_API_KEY) {
      try { const Anthropic = require('@anthropic-ai/sdk'); client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY, maxRetries: 2 }); }
      catch (e) { console.error('[project] Anthropic SDK unavailable:', e.message); }
    }
    const projector = createProjector({ client });
    const projection = await projector.project({ matches, prevProjection: prev });
    if (projection.reused) { console.log('[project] phase unchanged (' + projection.phase + ') — keeping existing projection'); return; }
    fs.writeFileSync(outPath, JSON.stringify(projection, null, 2) + '\n');
    console.log('[project] wrote ' + outPath + ' — phase=' + projection.phase + ' source=' + projection.source + ' champion=' + projection.championName);
  })().catch((e) => { console.error('[project] failed:', e.message); process.exit(1); });
}
