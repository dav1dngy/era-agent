// Request authentication for the loopback control plane.
//   * the listener binds 127.0.0.1 only (see server.js);
//   * every API request needs the per-launch bearer token (constant-time compared);
//   * Host must be the loopback address we bound (defeats DNS rebinding);
//   * a browser-supplied Origin must be our own origin (defeats cross-site requests);
//   * mutations must be JSON (a cross-site form post cannot send application/json without a CORS preflight, which we never grant).
import { randomBytes, timingSafeEqual } from 'node:crypto';

export const newToken = () => randomBytes(32).toString('hex');

const same = (a, b) => {
  const x = Buffer.from(String(a));
  const y = Buffer.from(String(b));
  return x.length === y.length && timingSafeEqual(x, y);
};

export function checkHostAndOrigin(req, port) {
  const allowedHosts = [`127.0.0.1:${port}`, `localhost:${port}`];
  if (!allowedHosts.includes(req.headers.host ?? '')) return { ok: false, status: 421, error: 'Unexpected Host header' };
  const origin = req.headers.origin;
  if (origin !== undefined && !allowedHosts.some((h) => origin === `http://${h}`)) return { ok: false, status: 403, error: 'Cross-origin requests are not allowed' };
  return { ok: true };
}

export function checkToken(req, token) {
  const header = req.headers.authorization ?? '';
  const m = /^Bearer (.+)$/.exec(header);
  if (!m || !same(m[1], token)) return { ok: false, status: 401, error: 'Missing or invalid token' };
  return { ok: true };
}

export function checkMutationContentType(req) {
  // DELETE carries no body and is not a CORS "simple" method (a cross-site DELETE needs a preflight we never grant).
  if (['GET', 'HEAD', 'OPTIONS', 'DELETE'].includes(req.method)) return { ok: true };
  const type = (req.headers['content-type'] ?? '').split(';')[0].trim().toLowerCase();
  return type === 'application/json' ? { ok: true } : { ok: false, status: 415, error: 'Content-Type must be application/json' };
}
