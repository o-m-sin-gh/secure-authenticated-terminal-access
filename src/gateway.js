'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const http = require('node:http');
const net = require('node:net');
const path = require('node:path');
const { createTerminalToken, verifyTerminalToken, tokenFingerprint } = require('./token');

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------
const port = Number(process.env.PORT || 8080);
const config = {
  port,
  ttydHost: process.env.TTYD_HOST || '127.0.0.1',
  ttydPort: Number(process.env.TTYD_PORT || 7681),
  secret: process.env.TERMINAL_TOKEN_SECRET,
  auditLogPath: process.env.AUDIT_LOG_PATH || path.join(process.cwd(), 'logs', 'terminal-access.jsonl'),
  cookieSecure: process.env.COOKIE_SECURE !== 'false',
  allowedOrigins: (process.env.ALLOWED_ORIGINS || `http://localhost:${port}`)
    .split(',').map(s => s.trim()).filter(Boolean),
  frameAncestors: process.env.FRAME_ANCESTORS || "'self'",
  adminKey: process.env.ADMIN_KEY,
  adminPort: Number(process.env.ADMIN_PORT || 9090)
};

if (!config.secret || config.secret.length < 32) {
  throw new Error('TERMINAL_TOKEN_SECRET must be at least 32 characters');
}

// ---------------------------------------------------------------------------
// In-memory security state (use Redis if you run more than one gateway)
// ---------------------------------------------------------------------------
const usedJti = new Map();   // jti -> exp (seconds): launch tokens are single-use
const revoked = new Set();   // revoked session ids
const live = new Map();      // sid -> Set<{ client, upstream }> of open WebSockets
const failures = new Map();  // ip -> { count, resetAt }
const FAIL_LIMIT = 10;
const FAIL_WINDOW_MS = 60_000;

const securityHeaders = {
  'Referrer-Policy': 'no-referrer',
  'X-Content-Type-Options': 'nosniff',
  'Cache-Control': 'no-store',
  'Content-Security-Policy': `frame-ancestors ${config.frameAncestors}`
};

function consumeJti(payload) {
  if (usedJti.has(payload.jti)) return false; // replay
  usedJti.set(payload.jti, payload.exp);
  return true;
}

function isLimited(ip) {
  const entry = failures.get(ip);
  return !!entry && entry.resetAt > Date.now() && entry.count >= FAIL_LIMIT;
}

function noteFailure(ip) {
  const entry = failures.get(ip);
  if (!entry || entry.resetAt <= Date.now()) {
    failures.set(ip, { count: 1, resetAt: Date.now() + FAIL_WINDOW_MS });
  } else {
    entry.count++;
  }
}

// Purge expired entries so the maps cannot grow forever.
setInterval(() => {
  const nowSec = Math.floor(Date.now() / 1000);
  for (const [jti, exp] of usedJti) if (exp <= nowSec) usedJti.delete(jti);
  for (const [ip, entry] of failures) if (entry.resetAt <= Date.now()) failures.delete(ip);
}, 60_000).unref();

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function cookies(header = '') {
  return Object.fromEntries(
    header.split(';').map(v => v.trim().split(/=(.*)/s, 2)).filter(([key]) => key)
  );
}

function auditRaw(event) {
  fs.mkdirSync(path.dirname(config.auditLogPath), { recursive: true });
  fs.appendFileSync(
    config.auditLogPath,
    `${JSON.stringify({ at: new Date().toISOString(), ...event })}\n`,
    { mode: 0o600 }
  );
}

// Never logs raw tokens or cookies: only SHA-256 fingerprints.
function audit(req, outcome, token, payload) {
  auditRaw({
    outcome,
    method: req.method,
    path: new URL(req.url, 'http://gateway').pathname,
    remoteIp: req.socket.remoteAddress,
    tokenId: token ? tokenFingerprint(token) : undefined,
    sessionId: payload ? tokenFingerprint(payload.sid) : undefined
  });
}

// allowLaunch=false for WebSockets: they may authenticate with the cookie only.
function authenticate(req, allowLaunch = true) {
  const url = new URL(req.url, 'http://gateway');
  const supplied = allowLaunch ? url.searchParams.get('terminal_token') : null;
  const token = supplied || cookies(req.headers.cookie).terminal_session;
  const result = verifyTerminalToken(token, {
    secret: config.secret,
    typ: supplied ? 'launch' : 'session'
  });
  const base = { token, supplied, url };
  if (!result.ok) return { ...result, ...base };
  if (revoked.has(result.payload.sid)) return { ok: false, reason: 'revoked-session', ...base };
  if (supplied && !consumeJti(result.payload)) return { ok: false, reason: 'replayed-token', ...base };
  return { ...result, ...base };
}

function unauthorized(req, res, auth) {
  noteFailure(req.socket.remoteAddress);
  audit(req, auth.reason || 'missing-token', auth.token);
  res.writeHead(401, { 'Content-Type': 'text/plain', ...securityHeaders });
  res.end('terminal authentication required\n');
}

function upstreamPath(url) {
  url.searchParams.delete('terminal_token');
  return `${url.pathname}${url.search}`;
}

// Headers sent to ttyd: the auth cookie is never forwarded.
function forwardHeaders(req) {
  const headers = { ...req.headers, host: `${config.ttydHost}:${config.ttydPort}` };
  delete headers.cookie;
  return headers;
}

// ---------------------------------------------------------------------------
// HTTP proxy
// ---------------------------------------------------------------------------
function proxyHttp(req, res, auth) {
  const upstream = http.request(
    {
      host: config.ttydHost,
      port: config.ttydPort,
      method: req.method,
      path: upstreamPath(auth.url),
      headers: forwardHeaders(req)
    },
    upstreamRes => {
      res.writeHead(upstreamRes.statusCode, { ...upstreamRes.headers, ...securityHeaders });
      upstreamRes.pipe(res);
    }
  );
  upstream.on('error', () => {
    if (!res.headersSent) res.writeHead(502);
    res.end('terminal unavailable\n');
  });
  req.pipe(upstream);
}

const server = http.createServer((req, res) => {
  if (isLimited(req.socket.remoteAddress)) {
    audit(req, 'rate-limited');
    res.writeHead(429, { 'Retry-After': '60', ...securityHeaders });
    return res.end('too many attempts\n');
  }

  const auth = authenticate(req);
  if (!auth.ok) return unauthorized(req, res, auth);

  // First visit: single-use launch token -> exchange for a session cookie.
  if (auth.supplied) {
    audit(req, 'accepted-launch', auth.token, auth.payload);
    const endsAt = auth.payload.lab || auth.payload.exp;
    const ttl = Math.max(1, endsAt - Math.floor(Date.now() / 1000));
    const sessionToken = createTerminalToken({
      sessionId: auth.payload.sid,
      secret: config.secret,
      typ: 'session',
      ttlSeconds: ttl
    });
    const secure = config.cookieSecure ? '; Secure' : '';
    res.writeHead(302, {
      ...securityHeaders,
      Location: upstreamPath(auth.url),
      'Set-Cookie': `terminal_session=${sessionToken}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${ttl}${secure}`
    });
    return res.end();
  }

  proxyHttp(req, res, auth);
});

// ---------------------------------------------------------------------------
// WebSocket proxy (this is where the shell actually lives)
// ---------------------------------------------------------------------------
server.on('upgrade', (req, client, head) => {
  const ip = req.socket.remoteAddress;

  const reject = (code, text, outcome, auth = {}) => {
    noteFailure(ip);
    audit(req, outcome, auth.token);
    client.write(`HTTP/1.1 ${code} ${text}\r\nConnection: close\r\n\r\n`);
    client.destroy();
  };

  if (isLimited(ip)) return reject(429, 'Too Many Requests', 'rate-limited');

  const auth = authenticate(req, false); // cookie only
  if (!auth.ok) return reject(401, 'Unauthorized', auth.reason || 'missing-token', auth);

  // Blocks cross-site WebSocket hijacking.
  const origin = req.headers.origin;
  if (!origin || !config.allowedOrigins.includes(origin)) {
    return reject(403, 'Forbidden', 'bad-origin', auth);
  }

  audit(req, 'accepted-websocket', auth.token, auth.payload);
  const sid = auth.payload.sid;

  const upstream = net.connect(config.ttydPort, config.ttydHost, () => {
    const request = [
      `${req.method} ${upstreamPath(auth.url)} HTTP/${req.httpVersion}`,
      ...Object.entries(forwardHeaders(req)).map(([key, value]) => `${key}: ${value}`),
      '',
      ''
    ].join('\r\n');
    upstream.write(request);
    if (head.length) upstream.write(head);
    client.pipe(upstream).pipe(client);
  });

  // Track the socket so revocation can kill it, and force-close at token expiry.
  const pair = { client, upstream };
  if (!live.has(sid)) live.set(sid, new Set());
  live.get(sid).add(pair);

  const timer = setTimeout(close, Math.max(0, auth.payload.exp * 1000 - Date.now()));
  function close() {
    clearTimeout(timer);
    client.destroy();
    upstream.destroy();
    live.get(sid)?.delete(pair);
  }
  upstream.on('error', close);
  client.on('error', close);
  upstream.on('close', close);
  client.on('close', close);
});

server.listen(config.port, () => {
  console.log(`Authenticated terminal gateway listening on ${config.port}`);
});

// ---------------------------------------------------------------------------
// Revocation ("Stop Lab" hook) on a separate, unpublished admin port
// ---------------------------------------------------------------------------
function revokeSession(sid) {
  revoked.add(sid);
  for (const { client, upstream } of live.get(sid) || []) {
    client.destroy();
    upstream.destroy();
  }
  live.delete(sid);
  auditRaw({ outcome: 'session-revoked', sessionId: tokenFingerprint(sid) });
}

if (config.adminKey) {
  http.createServer((req, res) => {
    const given = Buffer.from(String(req.headers['x-admin-key'] || ''));
    const want = Buffer.from(config.adminKey);
    const ok = given.length === want.length && crypto.timingSafeEqual(given, want);
    if (!ok) {
      res.writeHead(401);
      return res.end();
    }
    const match = req.method === 'POST' && /^\/revoke\/([\w-]+)$/.exec(req.url);
    if (!match) {
      res.writeHead(404);
      return res.end();
    }
    revokeSession(match[1]);
    res.writeHead(204);
    res.end();
  }).listen(config.adminPort, '0.0.0.0');
}