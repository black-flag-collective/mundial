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

const PORT = process.env.SMOKE_PORT || 3999;
const BASE = `http://127.0.0.1:${PORT}`;
const BOOT_TIMEOUT_MS = 15000;

function get(pathname) {
  return new Promise((resolve, reject) => {
    const req = http.get(`${BASE}${pathname}`, res => {
      let body = '';
      res.on('data', c => (body += c));
      res.on('end', () => resolve({ status: res.statusCode, body }));
    });
    req.on('error', reject);
    req.setTimeout(5000, () => req.destroy(new Error('request timeout')));
  });
}

async function waitForBoot() {
  const start = Date.now();
  while (Date.now() - start < BOOT_TIMEOUT_MS) {
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
    env: { ...process.env, PORT, ANTHROPIC_API_KEY: '' },
    stdio: 'inherit'
  });

  let failed = false;
  try {
    await waitForBoot();

    const index = await get('/');
    check('GET / returns 200', index.status === 200);
    check('GET / serves the app shell', /<x-dc>/.test(index.body));

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
