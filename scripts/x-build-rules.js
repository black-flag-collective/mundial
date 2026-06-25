'use strict';

/**
 * Build X API v2 Filtered Stream rules for the 2026 World Cup.
 *
 * One rule per nation, tagged with the FIFA 3-letter code, so every matched
 * Post is attributable to a country and can be fed straight into the buzz
 * engine (scripts/buzz-engine.js → state[code]) and onto the globe.
 *
 * Docs: https://docs.x.com/x-api/posts/filtered-stream/integrate/build-a-rule.md
 *
 * Usage:
 *   node scripts/x-build-rules.js            # all 48 nations → JSON {add:[...]}
 *   node scripts/x-build-rules.js --fixtures # only teams present in data/matches.json
 */

// FIFA code → country name (the 48 qualified nations). Kept in sync with
// packages/mundial-ui/src/data/teams.ts.
const CODE_NAME = {
  MEX: 'Mexico', RSA: 'South Africa', KOR: 'South Korea', CZE: 'Czechia',
  CAN: 'Canada', SUI: 'Switzerland', QAT: 'Qatar', BIH: 'Bosnia & Herzegovina',
  BRA: 'Brazil', MAR: 'Morocco', HAI: 'Haiti', SCO: 'Scotland',
  USA: 'United States', PAR: 'Paraguay', AUS: 'Australia', TUR: 'Türkiye',
  GER: 'Germany', CUW: 'Curaçao', CIV: "Côte d'Ivoire", ECU: 'Ecuador',
  NED: 'Netherlands', JPN: 'Japan', TUN: 'Tunisia', SWE: 'Sweden',
  BEL: 'Belgium', EGY: 'Egypt', IRN: 'Iran', NZL: 'New Zealand',
  ESP: 'Spain', CPV: 'Cabo Verde', KSA: 'Saudi Arabia', URU: 'Uruguay',
  FRA: 'France', SEN: 'Senegal', NOR: 'Norway', IRQ: 'Iraq',
  ARG: 'Argentina', ALG: 'Algeria', AUT: 'Austria', JOR: 'Jordan',
  POR: 'Portugal', UZB: 'Uzbekistan', COL: 'Colombia', COD: 'DR Congo',
  ENG: 'England', CRO: 'Croatia', GHA: 'Ghana', PAN: 'Panama',
};

// Extra match aliases for nations whose name varies on X, plus widely-used team
// nicknames. These feed the stream rule, the counts query, AND the trend→nation
// attribution (so a trending nickname lights the right nation on the globe). Only
// high-confidence, unambiguous forms are listed — nothing shared between two field
// nations (e.g. "Seleção" is both Brazil and Portugal, so it's omitted), and the
// WorldCup CONTEXT filter keeps a nickname from matching unrelated chatter.
const ALIASES = {
  // Alternate spellings / English exonyms
  BRA: ['Brasil'], TUR: ['Turkey'], CIV: ['Ivory Coast'], CPV: ['Cape Verde'],
  COD: ['Congo', 'DRC'], CZE: ['Czech Republic'],
  // Alt-spelling + nickname
  KOR: ['Korea', 'Taegeuk Warriors'], NED: ['Holland', 'Oranje'],
  USA: ['United States of America', 'USMNT'], RSA: ['Bafana Bafana'],
  // Nicknames (one well-known form per nation)
  ARG: ['Albiceleste'], FRA: ['Les Bleus'], ESP: ['La Roja', 'España'], ENG: ['Three Lions'],
  JPN: ['Samurai Blue'], AUS: ['Socceroos'], MAR: ['Atlas Lions', 'Maroc'], GHA: ['Black Stars'],
  EGY: ['Pharaohs'], MEX: ['El Tri', 'México'], GER: ['Die Mannschaft', 'Deutschland'], SCO: ['Tartan Army'],
  IRN: ['Team Melli'], NZL: ['All Whites'], KSA: ['Green Falcons'], URU: ['La Celeste'],
  SEN: ['Lions of Teranga'], ALG: ['Les Fennecs'], TUN: ['Eagles of Carthage'],
};

// Stay safely under the pay-per-use rule-length cap (1,024 chars).
const MAX_RULE_LEN = 1000;

// World-Cup context so a bare team name/hashtag doesn't match unrelated chatter.
const CONTEXT = '(#WorldCup2026 OR #FIFAWorldCup OR "world cup" OR worldcup)';

/** Build the rule object for a single nation. */
function ruleForTeam(code) {
  const name = CODE_NAME[code];
  if (!name) return null;
  const names = [name, ...(ALIASES[code] || [])].map((n) => `"${n}"`);
  const value = `(${names.join(' OR ')} OR #${code}) ${CONTEXT} -is:retweet`;
  return { value, tag: code };
}

/**
 * Build rules for the given codes (defaults to all 48). Returns
 * [{ value, tag }] ready to POST to /2/tweets/search/stream/rules.
 */
function buildTeamRules(codes) {
  const list = codes && codes.length ? codes : Object.keys(CODE_NAME);
  const rules = [];
  for (const code of list) {
    const rule = ruleForTeam(code);
    if (!rule) continue;
    if (rule.value.length > MAX_RULE_LEN) {
      console.warn(`[x-build-rules] ${code} rule is ${rule.value.length} chars (> ${MAX_RULE_LEN}); trim aliases`);
    }
    rules.push(rule);
  }
  return rules;
}

/** FIFA codes that actually appear in the current fixtures (data/matches.json). */
function codesInFixtures() {
  try {
    const m = require('../data/matches.json');
    const set = new Set();
    for (const arr of Object.values(m.dayMatches || {})) {
      for (const match of arr) {
        if (match.a) set.add(match.a);
        if (match.b) set.add(match.b);
      }
    }
    return [...set];
  } catch {
    return [];
  }
}

module.exports = { buildTeamRules, ruleForTeam, codesInFixtures, CODE_NAME, ALIASES, CONTEXT };

if (require.main === module) {
  const onlyFixtures = process.argv.includes('--fixtures');
  const codes = onlyFixtures ? codesInFixtures() : null;
  const rules = buildTeamRules(codes);
  console.log(JSON.stringify({ add: rules }, null, 2));
  console.error(`# ${rules.length} rule(s) — ${onlyFixtures ? 'fixtures only' : 'all 48 nations'}`);
}
