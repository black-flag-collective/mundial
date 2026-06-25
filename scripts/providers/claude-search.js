'use strict';

/**
 * Claude web-search results provider — the FALLBACK source.
 *
 * Wraps the original updater logic: ask Claude (with the web_search tool) for the
 * latest WC2026 results and parse a <match_data> JSON block into the normalized
 * { new_days, updated_matches } shape that mergeUpdate() consumes.
 *
 * Implements the ResultsProvider contract (see provider.js). Graceful
 * degradation: a persistent 429 (rate limit) OR a 400 "credit balance too low"
 * resolves to null — logged, run skipped — instead of throwing. Neither should
 * turn the scheduled Action red or spam notifications; the next tick (or the
 * primary source) will carry on.
 */

const { TEAM_CODES } = require('./team-codes');

/** Build the user prompt describing what still needs results (pure). */
function buildPrompt(current) {
  const today = new Date();
  const todayStr = today.toLocaleDateString('en-US', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
  });

  // Build a summary of what's still upcoming (needs results)
  const upcomingList = [];
  current.days.forEach((d, i) => {
    const ms = current.dayMatches[i] || [];
    ms.forEach((m) => {
      if (m.st !== 'FT') {
        upcomingList.push(`${d.short}: ${m.a} vs ${m.b} (Group ${m.g})`);
      }
    });
  });

  const lastDay = current.days[current.days.length - 1]?.short || 'Jun 18';

  return `
You are updating match data for a live FIFA World Cup 2026 tracker.

Today is: ${todayStr}

TEAM CODES (use exactly these strings):
${TEAM_CODES.join(', ')}

Current data covers: Jun 11 – ${lastDay}

Matches still marked as UPCOMING that may now have results:
${upcomingList.length ? upcomingList.join('\n') : '(none)'}

Please:
1. Search the web for any FIFA World Cup 2026 match results that happened since ${lastDay} and up to now
2. Search for today's full schedule if not already in the data
3. Find results for any UPCOMING matches listed above that have since been played

Return your findings as a JSON object inside <match_data> tags with this exact structure:

<match_data>
{
  "new_days": [
    {
      "day_short": "Jun 19",
      "day_long": "June 19",
      "day_dow": "Friday",
      "matches": [
        { "g": "GROUP_LETTER", "a": "TEAM_CODE", "b": "TEAM_CODE", "as": 0, "bs": 0, "st": "FT", "venue": "Venue Name" },
        { "g": "GROUP_LETTER", "a": "TEAM_CODE", "b": "TEAM_CODE", "st": "UP", "time": "6:00 PM ET", "venue": "Venue Name" }
      ]
    }
  ],
  "updated_matches": [
    { "day_short": "Jun 18", "a": "SUI", "b": "BIH", "as": 2, "bs": 0, "st": "FT" }
  ]
}
</match_data>

Rules:
- Only include "new_days" for days not already in the data (after ${lastDay})
- Only include "updated_matches" for matches that have changed status (UP → FT or LIVE)
- Use "st": "FT" only for confirmed final scores. Use "st": "UP" for scheduled matches not yet played.
- For matches still in the future, include them in new_days with st: "UP" and a "time" field
- If a day has no matches or you're unsure, omit it from new_days
- Keep as/bs as integers (goals scored)
- Venue: use short form like "MetLife Stadium, NJ" or "SoFi Stadium, LA"
- If there is nothing to update, return empty arrays: { "new_days": [], "updated_matches": [] }
`;
}

/** Extract <match_data>…</match_data> JSON block from Claude's text response (pure). */
function parseResponseJson(text) {
  const m = text.match(/<match_data>([\s\S]*?)<\/match_data>/);
  if (m) {
    try { return JSON.parse(m[1].trim()); } catch { /* fall through */ }
  }
  // Fallback: look for a raw JSON object
  const jsonM = text.match(/\{[\s\S]*"new_days"[\s\S]*\}/);
  if (jsonM) {
    try { return JSON.parse(jsonM[0]); } catch { /* fall through */ }
  }
  return null;
}

/**
 * Is this API error a transient/again-down condition we should skip (return
 * null) rather than fail the whole run over? A persistent 429 after the SDK's
 * own retries, or a 400 for an exhausted credit balance, both mean "this source
 * is simply unavailable right now" — exactly the case the cron should ride out.
 */
function isSkippableApiError(err) {
  if (!err) return false;
  if (err.status === 429) return true;
  if (err.status === 400 && /credit balance is too low/i.test(err.message || '')) return true;
  return false;
}

/**
 * Create the Claude provider. `client` is an Anthropic SDK client (plain or the
 * @posthog/ai wrapper), injectable for tests. `aiObservability` attaches PostHog
 * metadata to the request — ONLY valid when `client` is the wrapper, since the
 * plain SDK would forward the unknown fields to the API.
 */
function createClaudeProvider({ client, aiObservability = false, log = console } = {}) {
  return {
    name: 'claude-web-search',
    isAvailable() { return !!client; },
    async fetchUpdate(current) {
      const prompt = buildPrompt(current);

      // Keep the request lightweight. Each web_search result page is pulled back
      // into context as input tokens, so a high max_uses can blow past a low
      // input-tokens-per-minute rate limit mid-request (429). Three searches
      // covers "results since last day", "today's schedule", and "upcoming
      // results" while keeping the token footprint small.
      let response;
      try {
        const createBody = {
          model: 'claude-sonnet-4-6',
          max_tokens: 3072,
          tools: [{ type: 'web_search_20250305', name: 'web_search', max_uses: 3 }],
          messages: [{ role: 'user', content: prompt }],
        };
        if (aiObservability) {
          createBody.posthogDistinctId = 'match-data-updater';
          createBody.posthogProperties = { feature: 'match_data_updater', model: 'claude-sonnet-4-6' };
        }
        // maxRetries per-request so it applies on the wrapper too (its
        // constructor takes none); honors the API's retry-after on 429/5xx.
        response = await client.messages.create(createBody, { maxRetries: 5 });
      } catch (err) {
        if (isSkippableApiError(err)) {
          const h = err.headers;
          const reset = h && (typeof h.get === 'function'
            ? h.get('anthropic-ratelimit-input-tokens-reset')
            : h['anthropic-ratelimit-input-tokens-reset']);
          const why = err.status === 429 ? 'Rate limited (429)' : 'Credit balance too low (400)';
          (log.warn || console.warn)(
            `[update] claude-web-search: ${why}. Skipping this source; `
            + `the primary source or the next run will retry.${reset ? ` Input-token limit resets at ${reset}.` : ''}`,
          );
          return null;
        }
        throw err;
      }

      // Extract text from response (may contain tool_result blocks from web search)
      const textBlocks = response.content.filter((b) => b.type === 'text');
      const fullText = textBlocks.map((b) => b.text).join('\n');

      const update = parseResponseJson(fullText);
      if (!update) {
        (log.warn || console.warn)(
          '[update] claude-web-search: could not parse a structured response. Raw:\n',
          fullText.slice(0, 500),
        );
        return null;
      }
      return update;
    },
  };
}

module.exports = { createClaudeProvider, buildPrompt, parseResponseJson, isSkippableApiError };
