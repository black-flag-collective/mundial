/**
 * Smoke test: boot the server and assert the core endpoints serve correctly.
 *
 * Zero extra dependencies — uses Node built-ins only. Run with `npm test`.
 * Catches gross regressions (server won't boot, data file invalid, assets
 * missing) before a deploy.
 */

const { spawn } = require('child_process');
const http = require('http');
const path = require('path');

const PORT = Number(process.env.SMOKE_PORT) || 3999;
const BASE = `http://127.0.0.1:${PORT}`;
const BOOT_TIMEOUT_MS = 15000;

function get(pathname) {
  return new Promise((resolve, reject) => {
    const req = http.get(`${BASE}${pathname}`, res => {
      let body = '';
      res.on('data', c => (body += c));
      res.on('end', () => resolve({ status: res.statusCode, body, headers: res.headers }));
    });
    req.on('error', reject);
    req.setTimeout(5000, () => req.destroy(new Error('request timeout')));
  });
}

async function waitForBoot(server) {
  const start = Date.now();
  while (Date.now() - start < BOOT_TIMEOUT_MS) {
    if (server.exitCode !== null) {
      throw new Error(`server exited before boot (code ${server.exitCode})`);
    }
    try {
      const res = await get('/');
      if (res.status === 200) return;
    } catch {
      /* not up yet */
    }
    await new Promise(r => setTimeout(r, 250));
  }
  throw new Error(`server did not boot within ${BOOT_TIMEOUT_MS}ms`);
}

const checks = [];
function check(name, condition) {
  checks.push({ name, ok: !!condition });
}

async function run() {
  const root = path.join(__dirname, '..');
  const server = spawn('node', ['server.js'], {
    cwd: root,
    env: { ...process.env, PORT: String(PORT), ANTHROPIC_API_KEY: '', RATE_LIMIT_MAX: '30' },
    stdio: 'inherit'
  });

  let failed = false;
  try {
    await waitForBoot(server);

    const index = await get('/');
    check('GET / returns 200', index.status === 200);
    check('GET / serves the app shell', /<x-dc>/.test(index.body));
    check('security headers present', index.headers['x-content-type-options'] === 'nosniff'
      && !!index.headers['x-frame-options'] && !!index.headers['referrer-policy']
      && !!index.headers['strict-transport-security']);
    check('framework header not advertised', !index.headers['x-powered-by']);

    const support = await get('/support.js');
    check('GET /support.js returns 200', support.status === 200);

    const data = await get('/api/data.json');
    check('GET /api/data.json returns 200', data.status === 200);

    let json = null;
    try {
      json = JSON.parse(data.body);
    } catch {
      /* leave json null */
    }
    check('data.json is valid JSON', json !== null);
    check('data.json has days[]', Array.isArray(json?.days) && json.days.length > 0);
    check('data.json has dayMatches[]', Array.isArray(json?.dayMatches));
    check('days and dayMatches align', Array.isArray(json?.days) && Array.isArray(json?.dayMatches) && json.days.length === json.dayMatches.length);
    check('exactly one day flagged today', Array.isArray(json?.days) && json.days.filter(d => d.today).length === 1);
    // The read-through cache must not be corrupted by the per-request `today`
    // mutation: a second request still returns exactly one today-flagged day.
    const data2 = JSON.parse((await get('/api/data.json')).body);
    check('cached data.json stays correct across requests (one today)',
      Array.isArray(data2.days) && data2.days.filter(d => d.today).length === 1);

    // Data-integrity: a fixture (team-pair) must appear on exactly one day. This
    // catches the class of bug where the updater scheduled the same match twice
    // (e.g. BRA–HAI on two days). Group-stage pairs are unique by definition.
    const pairDays = new Map();
    (json?.dayMatches || []).forEach((ms, i) => (ms || []).forEach(m => {
      const k = [m.a, m.b].sort().join('_');
      (pairDays.get(k) || pairDays.set(k, []).get(k)).push(json.days[i]?.short || i);
    }));
    const dupFixtures = [...pairDays.entries()].filter(([, days]) => days.length > 1);
    if (dupFixtures.length) {
      console.error('  duplicate fixtures: ' + dupFixtures.map(([k, d]) => `${k} on ${d.join(', ')}`).join('; '));
    }
    check('no duplicate fixtures across days', dupFixtures.length === 0);

    const buzz = await get('/api/buzz.json');
    check('GET /api/buzz.json returns 200', buzz.status === 200);

    let bjson = null;
    try {
      bjson = JSON.parse(buzz.body);
    } catch {
      /* leave bjson null */
    }
    check('buzz.json is valid JSON', bjson !== null);
    check('buzz.json has updatedAt/window/source',
      bjson && typeof bjson.updatedAt === 'string' && typeof bjson.window === 'string' && typeof bjson.source === 'string');
    check('buzz.json has non-empty buzz[]', Array.isArray(bjson?.buzz) && bjson.buzz.length > 0);
    const b0 = Array.isArray(bjson?.buzz) ? bjson.buzz[0] : null;
    check('buzz entries have code/score/spike/rank',
      b0 && typeof b0.code === 'string' && typeof b0.score === 'number' && typeof b0.spike === 'number' && typeof b0.rank === 'number');

    const trends = await get('/api/trends.json');
    check('GET /api/trends.json returns 200', trends.status === 200);
    let tjson = null;
    try { tjson = JSON.parse(trends.body); } catch { /* leave null */ }
    check('trends.json has locations[] + health', tjson && Array.isArray(tjson.locations) && typeof tjson.health === 'object');

    const predict = await get('/api/predict');
    check('GET /api/predict returns 200', predict.status === 200);
    let pjson = null;
    try { pjson = JSON.parse(predict.body); } catch { /* leave null */ }
    // No API key in CI → the Oracle reports unavailable (button hidden), not an error.
    check('predict reports availability flag', pjson && typeof pjson.available === 'boolean');

    const notFound = await get('/api/nope-does-not-exist');
    check('unknown route → generic 404, no framework/stack leak',
      notFound.status === 404 && /not found/.test(notFound.body) && !/Cannot GET|\bat \//.test(notFound.body));

    // Rate limit (test server runs with RATE_LIMIT_MAX=30): a burst to a dynamic
    // /api endpoint should eventually 429, while /api/predict stays exempt.
    let got429 = false;
    for (let i = 0; i < 45 && !got429; i++) {
      if ((await get('/api/buzz.json')).status === 429) got429 = true;
    }
    check('rate limit kicks in on an /api burst (429)', got429);
    check('/api/predict is exempt from the global limit', (await get('/api/predict')).status === 200);
  } catch (err) {
    failed = true;
    console.error(`\nSmoke test error: ${err.message}`);
  } finally {
    server.kill('SIGTERM');
  }

  console.log('');
  for (const c of checks) {
    console.log(`${c.ok ? '  ✅' : '  ❌'} ${c.name}`);
    if (!c.ok) failed = true;
  }

  if (failed) {
    console.error('\nSmoke test FAILED');
    process.exit(1);
  }
  console.log('\nSmoke test passed');
  process.exit(0);
}

run();
