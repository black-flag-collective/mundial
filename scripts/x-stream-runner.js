'use strict';

/**
 * Supervise the X Filtered Stream: connect, and on any disconnect reconnect
 * with backoff tuned to the failure type (per X's guidance).
 *
 * No-ops cleanly when X_BEARER_TOKEN is unset, so the server boots fine without
 * X configured (the app's simulated buzz keeps running unchanged).
 *
 * Docs: https://docs.x.com/x-api/fundamentals/handling-disconnections.md
 */

const { streamPosts } = require('./x-stream');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const jitter = (ms) => ms + Math.floor(Math.random() * 1000); // de-sync simultaneous reconnects

/**
 * Next backoff delay (ms) from the previous delay and the error.
 *
 * Failure-type tuning — the connection-limit cases are what bit us in prod, so
 * they get deliberate handling rather than a generic retry:
 *   • 409 Conflict   → another connection already holds X's single allowed slot.
 *                      YIELD hard (don't fight) so the existing leader keeps it;
 *                      a rolling deploy's old process releases within seconds.
 *   • 429/420        → connection rate-limited. Wait until the server's own
 *                      reset window (x-rate-limit-reset / retry-after) when known,
 *                      else exponential. Fighting this just extends the window.
 *   • 5xx            → upstream blip → exponential.
 *   • network/stall  → linear.
 */
function backoff(prev, err) {
  const status = err && err.status;
  const now = Date.now();
  const CAP = 900_000; // 15m
  // First failure waits `base`; each subsequent failure doubles, up to `cap`.
  const grow = (base, cap) => Math.min(prev ? prev * 2 : base, cap);

  if (status === 429 || status === 420) {
    const resetMs =
      (err && err.rateLimitResetMs) ||
      (err && err.retryAfterMs ? now + err.retryAfterMs : null);
    if (resetMs && resetMs > now) return jitter(Math.min(resetMs - now + 1_000, CAP));
    return jitter(grow(60_000, CAP));
  }
  if (status === 409) return jitter(grow(30_000, 300_000)); // yield: 30s → 5m
  if (status >= 500) return jitter(grow(5_000, 320_000)); // 5s → ~5m
  return Math.min(prev ? prev + 250 : 250, 16_000); // network/stall → linear, cap 16s
}

/**
 * Run the stream forever, reconnecting with backoff. `onPost(payload)` is
 * called per matched Post. Pass { signal } (AbortSignal) to stop cleanly — on
 * abort the in-flight connection is dropped so X's single slot is released
 * promptly (critical for graceful shutdown during a deploy). { log } overrides
 * the logger; { onStatus } receives connect/reconnect/close/disabled events.
 * Returns immediately (resolved) if no token is set.
 */
async function runForever(onPost, { signal, log = console, onStatus } = {}) {
  const status = (state, info) => { if (typeof onStatus === 'function') onStatus(state, info); };

  if (!process.env.X_BEARER_TOKEN) {
    log.warn('[x-stream] X_BEARER_TOKEN not set — live X stream disabled');
    status('disabled');
    return;
  }

  let delay = 0;
  while (!(signal && signal.aborted)) {
    try {
      await streamPosts(onPost, { signal, onOpen: () => status('connected') });
      delay = 0; // clean server-side close — reset backoff before reconnecting
      status('closed');
      log.warn('[x-stream] stream closed by server; reconnecting');
    } catch (e) {
      if (signal && signal.aborted) return; // graceful shutdown — stop, don't retry
      delay = backoff(delay, e);
      status('reconnecting', { status: e.status, message: e.message, retryMs: delay });
      log.warn(`[x-stream] down (${e.status || e.message}); retry in ${Math.round(delay / 1000)}s`);
    }
    if (delay) await sleep(delay);
  }
}

module.exports = { runForever, backoff };
