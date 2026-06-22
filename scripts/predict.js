'use strict';

/**
 * The "Buzz Oracle" — a data-grounded tournament prediction, generated on demand
 * by a VERY cheap AI call. It reads the live signals the app already has (global
 * buzz, X trends, results so far) and returns a measured, evidence-citing pick.
 *
 * Cost is tightly bounded — this only ever runs when a user taps "Ask the Oracle":
 *   - Cheapest model (claude-haiku-4-5) with a small max_tokens.
 *   - Server-side cache keyed by a coarse signature of the inputs, so thousands of
 *     viewers within the TTL share ONE call (the big saver).
 *   - Hard daily cap (circuit breaker) + a per-client min-interval.
 *   - Prompt-cached system prompt.
 * Absent ANTHROPIC_API_KEY the Oracle is unavailable and the UI hides the button.
 *
 * Tunables: X_PREDICT_MODEL, X_PREDICT_MAX_TOKENS (320), X_PREDICT_CACHE_MS
 * (300000=5m), X_PREDICT_RATE_MS (15000), X_PREDICT_DAILY_CAP (500).
 */

const SYSTEM = [
  'You are the Buzz Oracle, a measured, data-grounded football analyst for a 2026',
  'FIFA World Cup tracker. You are given three kinds of signal:',
  '(1) "Buzz" = how much a nation is being TALKED ABOUT on X right now — social',
  'attention/volume, NOT a measure of team quality. It is REAL measured X post',
  'volume only for nations currently in a live match; for everyone else it is a',
  'MODELED estimate from fan-base size and match-day state, so treat it as',
  'interest, not evidence of strength.',
  '(2) Results/form so far — the hard data.',
  '(3) Trending topics on X.',
  'Predict the champion and a plausible final. Weight RESULTS/FORM most for who',
  'actually wins; use buzz and trends only as the "what the world is watching"',
  'angle and narrative color. In "evidence", cite the specific signal behind the',
  'call and be honest about what buzz does and does not mean. Credible, not outlandish.',
  'champion and runnerUp MUST be FIFA codes from the field listed in the data.',
  'Respond with ONLY a JSON object, no prose, exactly:',
  '{"champion":"<FIFA code>","championName":"<name>","runnerUp":"<FIFA code>",',
  '"finalScore":"<e.g. 2-1>","hotTake":"<one vivid sentence>","evidence":"<one sentence citing the signals>"}',
].join(' ');

const DEFAULT_MODEL = 'claude-haiku-4-5';

/** The set of FIFA codes actually in this tournament's field (pure). */
function fieldCodes(matches) {
  const set = new Set();
  for (const day of (matches && matches.dayMatches) || []) {
    for (const m of day || []) { if (m.a) set.add(m.a); if (m.b) set.add(m.b); }
  }
  return [...set];
}

/** Compact per-team record from finished matches (pure). */
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

/**
 * Build the compact user-content string fed to the model (pure, small). The buzz
 * is split honestly: `liveCodes` (when `realActive`) are nations whose match is
 * live and therefore carry REAL X post volume; everyone else is the MODELED
 * attention estimate (popularity + match-day), clearly labelled as such.
 */
function buildContext({ matches, buzz, trends, liveCodes = [], realActive = false } = {}) {
  const rows = (buzz && buzz.buzz) || [];
  const score = (b) => Math.round((b.score || 0) * 100);
  const liveSet = new Set(realActive ? liveCodes : []);
  const realRows = rows.filter((b) => liveSet.has(b.code)).map((b) => `${b.code} ${score(b)}`);
  const modeledRows = rows.filter((b) => !liveSet.has(b.code)).slice(0, 8).map((b) => `${b.code} ${score(b)}`);

  const rec = summarizeResults(matches);
  const form = Object.keys(rec)
    .sort((a, b) => (rec[b].w * 3 + rec[b].d) - (rec[a].w * 3 + rec[a].d))
    .slice(0, 10)
    .map((c) => `${c} ${rec[c].w}W-${rec[c].d}D-${rec[c].l}L`).join(', ');
  const trendNames = []
    .concat(...(((trends && trends.locations) || []).map((l) => (l.trends || []).filter((t) => t.wc).map((t) => t.name))))
    .filter((v, i, a) => a.indexOf(v) === i).slice(0, 8).join(', ');

  const realLine = realRows.length
    ? `Real X post volume now (last ~10m, nations in a live match): ${realRows.join(', ')}`
    : 'Real X post volume: none right now (no live match or feed off) — the figures below are MODELED, not measured.';
  return [
    `Field — choose champion and runner-up ONLY from these FIFA codes: ${fieldCodes(matches).join(', ') || 'n/a'}`,
    'BUZZ = social attention on X (how much each nation is talked about), NOT team strength.',
    realLine,
    `Modeled attention index (0-100; popularity + match-day, NOT live volume): ${modeledRows.join(', ') || 'n/a'}`,
    `Results/form so far (hard data): ${form || 'no results yet'}`,
    `Trending on X: ${trendNames || 'n/a'}`,
    'Predict the champion and final now.',
  ].join('\n');
}

/** Coarse cache signature: prediction is stable while the top buzz set is (pure). */
function signatureOf(buzz) {
  const top = ((buzz && buzz.buzz) || []).slice(0, 8).map((b) => b.code).join(',');
  return `${new Date().toISOString().slice(0, 10)}|${top}`;
}

/**
 * Parse the model's JSON reply defensively → object or null (pure). When
 * `validCodes` is given, the champion must be one of them (the actual field) —
 * so a hallucinated or non-qualified pick is rejected rather than rendered as a
 * broken flag.
 */
function parsePrediction(text, validCodes) {
  if (!text) return null;
  const m = String(text).match(/\{[\s\S]*\}/);
  if (!m) return null;
  let o;
  try { o = JSON.parse(m[0]); } catch { return null; }
  if (!o || !o.champion) return null;
  const champion = String(o.champion).toUpperCase().slice(0, 4);
  if (validCodes && validCodes.length && !validCodes.includes(champion)) return null;
  return {
    champion,
    championName: String(o.championName || o.champion),
    runnerUp: o.runnerUp ? String(o.runnerUp).toUpperCase().slice(0, 4) : '',
    finalScore: String(o.finalScore || ''),
    hotTake: String(o.hotTake || ''),
    evidence: String(o.evidence || ''),
  };
}

const utcDay = () => new Date().toISOString().slice(0, 10);

/**
 * Build the Oracle. `client` is an Anthropic SDK client (injectable for tests).
 * predict({ context, signature, ip }) → { prediction, cached } or throws an
 * error with `.status` (429 too soon, 503 capped/unconfigured).
 */
function createOracle({ client, log = console, aiObservability = false } = {}) {
  const MODEL = process.env.X_PREDICT_MODEL || DEFAULT_MODEL;
  const MAX_TOKENS = Number(process.env.X_PREDICT_MAX_TOKENS) || 320;
  const CACHE_MS = Number(process.env.X_PREDICT_CACHE_MS) || 300_000;
  const RATE_MS = Number(process.env.X_PREDICT_RATE_MS) || 15_000;
  const DAILY_CAP = Number(process.env.X_PREDICT_DAILY_CAP) || 500;

  let day = utcDay();
  const stats = { model: MODEL, callsToday: 0, dailyCap: DAILY_CAP, capped: false, cacheHits: 0, lastCallMs: null };
  let cache = null; // { at, sig, value }
  const lastByIp = new Map();

  async function predict({ context, signature, ip = 'anon', distinctId, validCodes, now = Date.now() } = {}) {
    if (!client) { const e = new Error('Oracle unavailable (no API key)'); e.status = 503; throw e; }
    if (utcDay() !== day) { day = utcDay(); stats.callsToday = 0; stats.capped = false; }

    // Fresh cache for this signature → serve it (the main cost saver).
    if (cache && cache.sig === signature && now - cache.at < CACHE_MS) {
      stats.cacheHits++;
      return { prediction: cache.value, cached: true, generatedAt: new Date(cache.at).toISOString() };
    }

    // Per-client min-interval: a repeat caller gets the last cached pick, never a
    // fresh (billed) call. A first-ever call from an IP always passes.
    const last = lastByIp.get(ip);
    if (last != null && now - last < RATE_MS) {
      if (cache) { stats.cacheHits++; return { prediction: cache.value, cached: true, generatedAt: new Date(cache.at).toISOString() }; }
      const e = new Error('Easy there — the Oracle is still thinking. Try again in a moment.'); e.status = 429; throw e;
    }

    // Daily cap circuit breaker.
    if (stats.callsToday >= DAILY_CAP) {
      stats.capped = true;
      if (cache) { stats.cacheHits++; return { prediction: cache.value, cached: true, generatedAt: new Date(cache.at).toISOString() }; }
      const e = new Error('The Oracle has spoken enough for today.'); e.status = 503; throw e;
    }

    lastByIp.set(ip, now);
    const body = {
      model: MODEL,
      max_tokens: MAX_TOKENS,
      system: [{ type: 'text', text: SYSTEM, cache_control: { type: 'ephemeral' } }],
      messages: [{ role: 'user', content: context || '' }],
    };
    // Attach PostHog AI-observability metadata ONLY when `client` is the
    // @posthog/ai wrapper — the plain Anthropic SDK would forward these unknown
    // fields straight to the API. Ties the $ai_generation to the same distinct
    // ID as the oracle_* product events for this request.
    if (aiObservability) {
      body.posthogDistinctId = distinctId || ip;
      body.posthogProperties = { feature: 'buzz_oracle', model: MODEL };
    }
    const resp = await client.messages.create(body);
    stats.callsToday++;
    stats.lastCallMs = now;
    const text = (resp && Array.isArray(resp.content)) ? resp.content.map((b) => b.text || '').join('') : '';
    const prediction = parsePrediction(text, validCodes);
    if (!prediction) { const e = new Error('Oracle returned an unreadable prediction'); e.status = 502; throw e; }
    cache = { at: now, sig: signature, value: prediction };
    return { prediction, cached: false, generatedAt: new Date(now).toISOString() };
  }

  return { predict, stats: () => ({ ...stats }) };
}

module.exports = { createOracle, buildContext, fieldCodes, summarizeResults, signatureOf, parsePrediction, SYSTEM, DEFAULT_MODEL };
