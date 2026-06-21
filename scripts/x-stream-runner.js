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

/** Next backoff delay (ms) given the previous delay and the HTTP status. */
function backoff(prev, status) {
  if (status === 429 || status === 420) return Math.min((prev || 60_000) * 2, 900_000); // 1m → 15m
  if (status >= 500) return Math.min((prev || 5_000) * 2, 320_000); // 5s → ~5m
  return Math.min((prev || 250) + 250, 16_000); // network/stall → linear, cap 16s
}

/**
 * Run the stream forever, reconnecting with backoff. `onPost(payload)` is
 * called per matched Post. Pass { signal } (AbortSignal) to stop; { log } to
 * override the logger. Returns immediately (resolved) if no token is set.
 */
async function runForever(onPost, { signal, log = console } = {}) {
  if (!process.env.X_BEARER_TOKEN) {
    log.warn('[x-stream] X_BEARER_TOKEN not set — live X stream disabled');
    return;
  }

  let delay = 0;
  while (!(signal && signal.aborted)) {
    try {
      await streamPosts(onPost, { signal });
      delay = 0; // clean server-side close — reset backoff before reconnecting
      log.warn('[x-stream] stream closed by server; reconnecting');
    } catch (e) {
      if (signal && signal.aborted) return;
      delay = backoff(delay, e.status);
      log.warn(`[x-stream] down (${e.status || e.message}); retry in ${Math.round(delay / 1000)}s`);
    }
    if (delay) await sleep(delay);
  }
}

module.exports = { runForever, backoff };
