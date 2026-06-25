/**
 * Match data updater — orchestrator.
 *
 * Keeps standings and the bracket current by pulling the latest WC2026 results
 * from a chain of pluggable data sources and patching data/matches.json.
 *
 * SOLID shape: the orchestrator depends only on the small ResultsProvider
 * contract (see scripts/providers/provider.js), not on any concrete API.
 * Sources, in priority order:
 *   1. football-data.org  — structured, free, no hallucination  (PRIMARY)
 *   2. Claude + web_search — flexible, but costly/fallible       (FALLBACK)
 * A new source is added by dropping in another provider — this file, the merge
 * logic, and the persistence layer don't change (Open/Closed).
 *
 * Run manually:  node scripts/update-data.js
 * Scheduled:     every 30 min by .github/workflows/update-data.yml
 */

const Anthropic = require('@anthropic-ai/sdk');
const { PostHog } = require('posthog-node');
const { Anthropic: PostHogAnthropic } = require('@posthog/ai');
const fs = require('fs');
const path = require('path');

const { createSportsApiProvider } = require('./providers/sports-api');
const { createClaudeProvider } = require('./providers/claude-search');
const { runProviders, hasContent } = require('./providers/runner');

const DATA_PATH = path.join(__dirname, '..', 'data', 'matches.json');

function loadCurrentData() {
  if (!fs.existsSync(DATA_PATH)) return null;
  return JSON.parse(fs.readFileSync(DATA_PATH, 'utf8'));
}

function saveData(data) {
  data.updatedAt = new Date().toISOString();
  fs.mkdirSync(path.dirname(DATA_PATH), { recursive: true });
  fs.writeFileSync(DATA_PATH, JSON.stringify(data, null, 2));
}

/** Merge a provider's response into the existing data file.
 *  new_days        → append days/dayMatches, skipping fixtures we already have
 *  updated_matches → patch scores on not-yet-final entries
 *
 *  Returns { data, changed }. `changed` is true only when match content actually
 *  moved — so the caller can avoid rewriting the file (and triggering a deploy)
 *  on runs where the source echoed data we already had.
 *
 *  This is the source-agnostic heart of the updater: every provider returns the
 *  shape it consumes, and its invariants protect the data regardless of source.
 */
function mergeUpdate(current, update) {
  const data = JSON.parse(JSON.stringify(current)); // deep clone
  let changed = false;

  // Fixture identity = the team-pair PLUS its context (group letter or knockout
  // round). The pair alone isn't unique across the whole tournament: two teams
  // from the same group can advance and meet again in a knockout tie (e.g. the
  // final), so keying on the pair only would wrongly drop that rematch as a dup.
  // Adding the context (g for group ties, round for knockout ties) keeps each
  // distinct fixture while still deduping the same match reported on two days
  // (this is what produced the duplicate BRA–HAI).
  const pairKey = (x, y) => [x, y].sort().join('_');
  const fixtureKey = (m) => pairKey(m.a, m.b) + '|' + (m.g || m.round || '');
  const knownPairs = new Set();
  data.dayMatches.forEach(ms => ms.forEach(m => knownPairs.add(fixtureKey(m))));

  // Add new days (and fixtures on existing days), de-duplicating by fixture.
  if (Array.isArray(update.new_days)) {
    for (const nd of update.new_days) {
      if (!nd.day_short) continue;
      const fresh = (nd.matches || []).filter(m => {
        if (!m.a || !m.b) return false;
        const k = fixtureKey(m);
        if (knownPairs.has(k)) return false; // already scheduled elsewhere
        knownPairs.add(k);
        return true;
      });
      if (!fresh.length) continue; // nothing new on this day → skip
      const dayIdx = data.days.findIndex(d => d.short === nd.day_short);
      if (dayIdx < 0) {
        data.days.push({ dow: nd.day_dow, short: nd.day_short, long: nd.day_long });
        data.dayMatches.push(fresh);
      } else {
        data.dayMatches[dayIdx].push(...fresh);
      }
      changed = true;
    }
  }

  // Update individual match scores
  if (Array.isArray(update.updated_matches)) {
    for (const um of update.updated_matches) {
      const dayIdx = data.days.findIndex(d => d.short === um.day_short);
      if (dayIdx < 0) continue;
      const matches = data.dayMatches[dayIdx];
      const samePair = (x) => (x.a === um.a && x.b === um.b) || (x.a === um.b && x.b === um.a);
      // Prefer a same-context match (group letter / knockout round) when the
      // update carries one, so a knockout rematch never patches the group tie.
      const umCtx = um.g || um.round;
      const m = (umCtx && matches.find(x => samePair(x) && (x.g || x.round) === umCtx))
        || matches.find(samePair);
      // Safety invariant: a confirmed final is immutable. Only patch matches that
      // are not yet FT, and only with a final/live result. This guards against a
      // source silently rewriting a good score (e.g. CAN–QAT flipping
      // 2–0 → 6–0 between runs).
      if (m && m.st !== 'FT' && (um.st === 'FT' || um.st === 'LIVE')) {
        const flipped = m.a !== um.a;
        const newAs = flipped ? um.bs : um.as;
        const newBs = flipped ? um.as : um.bs;
        // Only record a change if something actually differs — otherwise a run
        // that re-reports an unchanged match would still trigger a deploy.
        if (m.as !== newAs || m.bs !== newBs || m.st !== um.st) {
          m.as = newAs;
          m.bs = newBs;
          m.st = um.st;
          delete m.time; // remove kickoff time once score is known
          changed = true;
        }
      }
    }
  }

  return { data, changed };
}

/**
 * Build the ordered provider chain from the environment. Each provider reports
 * its own availability, so an absent key simply skips that source.
 *   - sports API is primary (structured, free, reliable)
 *   - Claude web-search is the fallback (only reached if the primary can't run)
 */
function buildProviders({ client, aiObservability } = {}) {
  return [
    createSportsApiProvider({}),
    createClaudeProvider({ client, aiObservability }),
  ];
}

async function updateData({ phClient = null, providers = null } = {}) {
  // Construct the Anthropic client only when a key is present. When a PostHog
  // client is provided (POSTHOG_KEY set in CI), route through the @posthog/ai
  // wrapper so the fallback's web-search run is captured as an $ai_generation
  // event (model, tokens, cost). Without a key, the Claude provider reports
  // unavailable and the chain relies on the sports API alone.
  let client = null;
  if (process.env.ANTHROPIC_API_KEY) {
    client = phClient
      ? new PostHogAnthropic({ apiKey: process.env.ANTHROPIC_API_KEY, posthog: phClient })
      : new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY, maxRetries: 5 });
  }
  const aiObservability = !!(phClient && process.env.ANTHROPIC_API_KEY);

  const current = loadCurrentData();
  if (!current) throw new Error('No existing matches.json found');

  const chain = providers || buildProviders({ client, aiObservability });
  const { update, provider } = await runProviders(chain, current);

  if (!hasContent(update)) {
    console.log(`[update] No new results to add${provider ? ` (source: ${provider})` : ' (no source available)'}.`);
    return;
  }

  const hadNewDays = (update.new_days || []).length;
  const hadUpdates = (update.updated_matches || []).length;

  const { data: merged, changed } = mergeUpdate(current, update);
  if (!changed) {
    // The source reported items, but they were all dupes or already-final
    // matches, so nothing actually moved. Don't rewrite the file — saveData()
    // bumps updatedAt unconditionally, and a timestamp-only commit would trigger
    // a needless deploy.
    console.log(`[update] ${provider}: ${hadNewDays} day(s)/${hadUpdates} update(s), but no net change — skipping save.`);
    return;
  }
  saveData(merged);
  console.log(`[update] Saved from ${provider}: ${hadNewDays} new days, ${hadUpdates} match updates`);
}

// Allow direct execution
if (require.main === module) {
  if (!process.env.ANTHROPIC_API_KEY && !process.env.FOOTBALL_DATA_TOKEN) {
    console.error('Set FOOTBALL_DATA_TOKEN (primary) and/or ANTHROPIC_API_KEY (fallback) before running this script.');
    process.exit(1);
  }
  // Opt-in AI observability: with POSTHOG_KEY set (as a GitHub Actions secret),
  // the fallback's Claude call is captured in PostHog. Without it, runs exactly
  // as before. A short-lived CLI must flush before exit or queued events drop.
  const phClient = process.env.POSTHOG_KEY
    ? new PostHog(process.env.POSTHOG_KEY, { host: process.env.POSTHOG_HOST || 'https://us.i.posthog.com' })
    : null;
  updateData({ phClient })
    .catch(err => { console.error(err); process.exitCode = 1; })
    .finally(async () => { if (phClient) await phClient.shutdown(); });
}

module.exports = { updateData, mergeUpdate, buildProviders, loadCurrentData, saveData };
