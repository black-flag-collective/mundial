'use strict';

/**
 * Connect to the X API v2 Filtered Stream and emit each matched Post.
 *
 * Holds ONE persistent HTTP connection (the pay-per-use limit). Each matched
 * Post arrives hydrated with author + metrics and tagged with the rule(s) it
 * matched. Blank keep-alive lines (~every 20s) are skipped.
 *
 * Docs: https://docs.x.com/x-api/stream/stream-filtered-posts.md
 */

const STREAM_URL = 'https://api.x.com/2/tweets/search/stream';

// Hydrate each Post with what the buzz feed / UI needs, in one request.
const PARAMS = new URLSearchParams({
  'tweet.fields': 'created_at,lang,public_metrics,entities',
  expansions: 'author_id',
  'user.fields': 'name,username,profile_image_url,verified',
});

/**
 * Open the stream and call `onPost(payload)` for every matched Post, where
 * payload = { data, includes, matching_rules }. Resolves when the server
 * closes the connection; rejects on a non-OK HTTP status (with `.status`).
 * Pass an AbortSignal to stop.
 */
async function streamPosts(onPost, { signal, onOpen } = {}) {
  const token = process.env.X_BEARER_TOKEN;
  if (!token) throw new Error('X_BEARER_TOKEN is not set');

  const res = await fetch(`${STREAM_URL}?${PARAMS}`, {
    headers: { Authorization: `Bearer ${token}` },
    signal,
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    // Capture the server's rate-limit window so the runner can wait exactly
    // until it resets (instead of a blind exponential guess) on 429/420.
    const reset = res.headers.get('x-rate-limit-reset'); // epoch seconds
    const retryAfter = res.headers.get('retry-after'); // seconds
    throw Object.assign(new Error(`stream HTTP ${res.status} ${text.slice(0, 200)}`), {
      status: res.status,
      rateLimitResetMs: reset ? Number(reset) * 1000 : null,
      retryAfterMs: retryAfter ? Number(retryAfter) * 1000 : null,
    });
  }

  if (typeof onOpen === 'function') onOpen();

  // Body is newline-delimited JSON. Buffer across chunks; a line may split.
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = '';

  for (;;) {
    const { value, done } = await reader.read();
    if (done) break; // server closed — caller decides whether to reconnect
    buf += decoder.decode(value, { stream: true });

    let nl;
    while ((nl = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      if (!line) continue; // keep-alive heartbeat — connection is healthy
      let json;
      try {
        json = JSON.parse(line);
      } catch {
        continue; // partial / non-JSON line
      }
      try {
        onPost(json);
      } catch (e) {
        console.error('[x-stream] onPost handler error:', e.message);
      }
    }
  }
}

module.exports = { streamPosts, STREAM_URL };
