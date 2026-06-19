/**
 * Claude-powered match data updater.
 *
 * Uses the Anthropic API with web search to find the latest World Cup 2026
 * results and patch data/matches.json so standings and the bracket stay current.
 *
 * Run manually:  node scripts/update-data.js
 * Scheduled:    called automatically every 30 min by server.js when
 *               ANTHROPIC_API_KEY is set.
 */

const Anthropic = require('@anthropic-ai/sdk');
const fs = require('fs');
const path = require('path');

const DATA_PATH = path.join(__dirname, '..', 'data', 'matches.json');

// FIFA codes used in the app — Claude must stick to these exact strings
const TEAM_CODES = [
  'MEX','RSA','KOR','CZE','CAN','SUI','QAT','BIH',
  'BRA','MAR','HAI','SCO','USA','PAR','AUS','TUR',
  'GER','CUW','CIV','ECU','NED','JPN','TUN','SWE',
  'BEL','EGY','IRN','NZL','ESP','CPV','KSA','URU',
  'FRA','SEN','NOR','IRQ','ARG','ALG','AUT','JOR',
  'POR','UZB','COL','COD','ENG','CRO','GHA','PAN'
];

function loadCurrentData() {
  if (!fs.existsSync(DATA_PATH)) return null;
  return JSON.parse(fs.readFileSync(DATA_PATH, 'utf8'));
}

function saveData(data) {
  data.updatedAt = new Date().toISOString();
  fs.mkdirSync(path.dirname(DATA_PATH), { recursive: true });
  fs.writeFileSync(DATA_PATH, JSON.stringify(data, null, 2));
}

/** Merge Claude's response into the existing data file.
 *  new_days   → append days/dayMatches not already present
 *  updated_matches → patch scores on existing FT/UP entries
 */
function mergeUpdate(current, update) {
  const data = JSON.parse(JSON.stringify(current)); // deep clone

  // Add new days
  if (Array.isArray(update.new_days)) {
    for (const nd of update.new_days) {
      if (!nd.day_short) continue;
      const exists = data.days.some(d => d.short === nd.day_short);
      if (!exists) {
        data.days.push({ dow: nd.day_dow, short: nd.day_short, long: nd.day_long });
        data.dayMatches.push(nd.matches || []);
      }
    }
  }

  // Update individual match scores
  if (Array.isArray(update.updated_matches)) {
    for (const um of update.updated_matches) {
      const dayIdx = data.days.findIndex(d => d.short === um.day_short);
      if (dayIdx < 0) continue;
      const matches = data.dayMatches[dayIdx];
      const m = matches.find(x =>
        (x.a === um.a && x.b === um.b) || (x.a === um.b && x.b === um.a)
      );
      if (m && (um.st === 'FT' || um.st === 'LIVE')) {
        const flipped = m.a !== um.a;
        m.as = flipped ? um.bs : um.as;
        m.bs = flipped ? um.as : um.bs;
        m.st = um.st;
        delete m.time; // remove kickoff time once score is known
      }
    }
  }

  return data;
}

/** Extract <match_data>…</match_data> JSON block from Claude's text response */
function parseResponseJson(text) {
  const m = text.match(/<match_data>([\s\S]*?)<\/match_data>/);
  if (m) {
    try { return JSON.parse(m[1].trim()); } catch {}
  }
  // Fallback: look for a raw JSON object
  const jsonM = text.match(/\{[\s\S]*"new_days"[\s\S]*\}/);
  if (jsonM) {
    try { return JSON.parse(jsonM[0]); } catch {}
  }
  return null;
}

async function updateData() {
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  const current = loadCurrentData();
  if (!current) throw new Error('No existing matches.json found');

  const today = new Date();
  const todayStr = today.toLocaleDateString('en-US', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'
  });

  // Build a summary of what's still upcoming (needs results)
  const upcomingList = [];
  current.days.forEach((d, i) => {
    const ms = current.dayMatches[i] || [];
    ms.forEach(m => {
      if (m.st !== 'FT') {
        upcomingList.push(`${d.short}: ${m.a} vs ${m.b} (Group ${m.g})`);
      }
    });
  });

  const lastDay = current.days[current.days.length - 1]?.short || 'Jun 18';

  const prompt = `
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

  const response = await client.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 8192,
    tools: [
      {
        type: 'web_search_20250305',
        name: 'web_search',
        max_uses: 10
      }
    ],
    messages: [{ role: 'user', content: prompt }]
  });

  // Extract text from response (may contain tool_result blocks from web search)
  const textBlocks = response.content.filter(b => b.type === 'text');
  const fullText = textBlocks.map(b => b.text).join('\n');

  const update = parseResponseJson(fullText);
  if (!update) {
    console.warn('[update] Could not parse structured response from Claude. Raw response:\n', fullText.slice(0, 500));
    return;
  }

  const hadNewDays = (update.new_days || []).length;
  const hadUpdates = (update.updated_matches || []).length;

  if (!hadNewDays && !hadUpdates) {
    console.log('[update] No new results to add.');
    return;
  }

  const merged = mergeUpdate(current, update);
  saveData(merged);
  console.log(`[update] Saved: ${hadNewDays} new days, ${hadUpdates} match updates`);
}

// Allow direct execution
if (require.main === module) {
  if (!process.env.ANTHROPIC_API_KEY) {
    console.error('Set ANTHROPIC_API_KEY before running this script.');
    process.exit(1);
  }
  updateData().catch(err => { console.error(err); process.exit(1); });
}

module.exports = { updateData };
