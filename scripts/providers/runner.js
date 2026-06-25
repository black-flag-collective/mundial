'use strict';

/**
 * Chain-of-Responsibility over ResultsProviders.
 *
 * Tries each provider in order. Semantics:
 *  - not available (no key)          → skip to the next provider
 *  - threw                           → log, skip to the next provider (errors isolated)
 *  - returned null                   → "couldn't run this time" → fall through
 *  - returned an object (even empty) → AUTHORITATIVE for this run → stop and use it
 *
 * The last rule is the cost guard: when the primary source successfully reports
 * "nothing new" (empty arrays), we do NOT then burn a billed fallback call. The
 * fallback is reached only when the primary is unavailable, errored, or returned
 * null. Nothing in the chain can throw out, so one bad source never fails the run.
 */

function hasContent(u) {
  return !!(u && (((u.new_days || []).length) || ((u.updated_matches || []).length)));
}

async function runProviders(providers, current, { log = console } = {}) {
  for (const p of providers || []) {
    if (!p || typeof p.fetchUpdate !== 'function' || typeof p.isAvailable !== 'function') continue;
    if (!p.isAvailable()) {
      (log.log || console.log)(`[update] ${p.name}: not configured — skipping.`);
      continue;
    }
    let update;
    try {
      update = await p.fetchUpdate(current);
    } catch (err) {
      (log.error || console.error)(`[update] ${p.name}: errored — ${err && err.message}. Trying next source.`);
      continue;
    }
    if (update == null) {
      (log.log || console.log)(`[update] ${p.name}: unavailable this run — trying next source.`);
      continue;
    }
    // Provider ran successfully → authoritative for this run, even if empty.
    return { update, provider: p.name };
  }
  return { update: null, provider: null };
}

module.exports = { runProviders, hasContent };
