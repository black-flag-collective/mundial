'use strict';

/**
 * Manage X API v2 Filtered Stream rules (add / list / delete / replace).
 *
 * App-only OAuth 2.0 Bearer auth — set X_BEARER_TOKEN in the environment.
 * Docs: https://docs.x.com/x-api/stream/update-stream-rules.md
 *
 * Usage:
 *   node scripts/x-rules.js list                 # show active rules
 *   node scripts/x-rules.js replace [--fixtures] # install the World Cup team rules
 *   node scripts/x-rules.js clear                # delete every rule
 *   node scripts/x-rules.js dry-run [--fixtures] # validate rules without applying
 */

const RULES_URL = 'https://api.x.com/2/tweets/search/stream/rules';

function bearer() {
  const t = process.env.X_BEARER_TOKEN;
  if (!t) throw new Error('X_BEARER_TOKEN is not set');
  return t;
}

function authHeaders(extra) {
  return Object.assign({ Authorization: `Bearer ${bearer()}` }, extra || {});
}

function httpError(op, status, body) {
  const e = new Error(`${op} failed: HTTP ${status} — ${JSON.stringify(body).slice(0, 400)}`);
  e.status = status;
  e.body = body;
  return e;
}

/** GET the current rule set: { data?: [{id, value, tag}], meta }. */
async function listRules() {
  const r = await fetch(RULES_URL, { headers: authHeaders() });
  const body = await r.json();
  if (!r.ok) throw httpError('list rules', r.status, body);
  return body;
}

/** Add rules ([{ value, tag }]). Pass { dryRun: true } to validate only. */
async function addRules(rules, { dryRun = false } = {}) {
  if (!rules || !rules.length) return { meta: { summary: { created: 0 } } };
  const url = dryRun ? `${RULES_URL}?dry_run=true` : RULES_URL;
  const r = await fetch(url, {
    method: 'POST',
    headers: authHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ add: rules }),
  });
  const body = await r.json();
  if (!r.ok) throw httpError('add rules', r.status, body);
  return body;
}

/** Delete rules by id. */
async function deleteRules(ids) {
  if (!ids || !ids.length) return { meta: { summary: { deleted: 0 } } };
  const r = await fetch(RULES_URL, {
    method: 'POST',
    headers: authHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ delete: { ids } }),
  });
  const body = await r.json();
  if (!r.ok) throw httpError('delete rules', r.status, body);
  return body;
}

/** Replace the entire rule set: delete all existing, then add `rules`. */
async function replaceRules(rules) {
  const current = await listRules();
  const ids = (current.data || []).map((x) => x.id);
  if (ids.length) await deleteRules(ids);
  return addRules(rules);
}

module.exports = { listRules, addRules, deleteRules, replaceRules, RULES_URL };

if (require.main === module) {
  const cmd = process.argv[2];
  const onlyFixtures = process.argv.includes('--fixtures');

  (async () => {
    if (cmd === 'list') {
      const r = await listRules();
      const rules = r.data || [];
      console.log(`${rules.length} active rule(s):`);
      for (const x of rules) console.log(`  [${x.tag || '—'}] ${x.value}`);
      return;
    }

    if (cmd === 'replace' || cmd === 'dry-run') {
      const { buildTeamRules, codesInFixtures } = require('./x-build-rules');
      const rules = buildTeamRules(onlyFixtures ? codesInFixtures() : null);
      const res =
        cmd === 'dry-run'
          ? await addRules(rules, { dryRun: true })
          : await replaceRules(rules);
      console.log(JSON.stringify(res.meta || res, null, 2));
      return;
    }

    if (cmd === 'clear') {
      const cur = await listRules();
      const res = await deleteRules((cur.data || []).map((x) => x.id));
      console.log(JSON.stringify(res.meta || res, null, 2));
      return;
    }

    console.log('usage: node scripts/x-rules.js <list|replace|clear|dry-run> [--fixtures]');
    process.exit(1);
  })().catch((e) => {
    console.error(e.message);
    process.exit(1);
  });
}
