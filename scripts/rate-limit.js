'use strict';

/**
 * A tiny, dependency-free fixed-window rate limiter keyed by client IP.
 * Proportionate for a read-only hobby site: generous enough that a normal
 * browser tab's polling never trips it, low enough to stop a single IP
 * hammering an endpoint. Behind Fly's proxy the real client is in
 * `x-forwarded-for` (the socket IP is the proxy), so we key off its first hop.
 */

/** First-hop client IP from x-forwarded-for, falling back to req.ip. */
function clientIp(req) {
  const xff = req && req.headers && req.headers['x-forwarded-for'];
  return String(xff || (req && req.ip) || 'anon').split(',')[0].trim();
}

/**
 * createRateLimiter({ windowMs, max, now }) → { middleware, prune, hits }.
 * `now` is injectable for tests. Per IP, allow up to `max` requests per
 * `windowMs`; beyond that respond 429 + Retry-After.
 */
function createRateLimiter({ windowMs = 60_000, max = 1200, now = Date.now } = {}) {
  const hits = new Map(); // ip -> { count, resetAt }

  const middleware = (req, res, next) => {
    const ip = clientIp(req);
    const t = now();
    let e = hits.get(ip);
    if (!e || t >= e.resetAt) { e = { count: 0, resetAt: t + windowMs }; hits.set(ip, e); }
    e.count++;
    if (e.count > max) {
      res.set('Retry-After', String(Math.max(1, Math.ceil((e.resetAt - t) / 1000))));
      res.status(429).json({ error: 'rate limit exceeded — slow down' });
      return;
    }
    next();
  };

  // Drop expired entries so the map doesn't grow unbounded with one-off IPs.
  const prune = () => { const t = now(); for (const [ip, e] of hits) if (t >= e.resetAt) hits.delete(ip); };

  return { middleware, prune, hits };
}

module.exports = { createRateLimiter, clientIp };
