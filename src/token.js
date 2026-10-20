'use strict';

const crypto = require('node:crypto');

function encode(value) {
  return Buffer.from(JSON.stringify(value)).toString('base64url');
}

function decode(value) {
  return JSON.parse(Buffer.from(value, 'base64url').toString('utf8'));
}

function signature(encodedPayload, secret) {
  return crypto.createHmac('sha256', secret).update(encodedPayload).digest('base64url');
}

function tokenFingerprint(token) {
  return crypto.createHash('sha256').update(token).digest('hex').slice(0, 16);
}

// typ: 'launch' (short-lived, single-use, goes in the URL) or 'session' (cookie)
// labExp: lab end time in epoch seconds (carried inside launch tokens)
function createTerminalToken({ sessionId, secret, ttlSeconds = 3600, typ = 'session', labExp, now = Date.now() }) {
  if (!sessionId || !secret) throw new Error('sessionId and secret are required');
  const payload = {
    sid: sessionId,
    typ,
    exp: Math.floor(now / 1000) + ttlSeconds,
    jti: crypto.randomUUID(),
    ...(labExp ? { lab: labExp } : {})
  };
  const body = encode(payload);
  return `${body}.${signature(body, secret)}`;
}

function verifyTerminalToken(token, { secret, typ, now = Date.now() }) {
  if (!token || !secret) return { ok: false, reason: 'missing-token' };
  const [body, suppliedSignature, ...rest] = token.split('.');
  if (!body || !suppliedSignature || rest.length) return { ok: false, reason: 'malformed-token' };
  const expected = signature(body, secret);
  const a = Buffer.from(suppliedSignature);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return { ok: false, reason: 'invalid-token' };
  try {
    const payload = decode(body);
    if (!payload.sid || !payload.jti || !Number.isInteger(payload.exp)) return { ok: false, reason: 'malformed-token' };
    if (typ && payload.typ !== typ) return { ok: false, reason: 'wrong-token-type' };
    if (payload.exp <= Math.floor(now / 1000)) return { ok: false, reason: 'expired-token' };
    return { ok: true, payload };
  } catch {
    return { ok: false, reason: 'malformed-token' };
  }
}

// The URL carries a 60-second, single-use launch token.
// labTtlSeconds controls how long the resulting session cookie lasts.
function createTerminalUrl({ baseUrl, labTtlSeconds = 3600, now = Date.now(), ...options }) {
  const url = new URL(baseUrl);
  const labExp = Math.floor(now / 1000) + labTtlSeconds;
  url.searchParams.set(
    'terminal_token',
    createTerminalToken({ ...options, now, typ: 'launch', ttlSeconds: 60, labExp })
  );
  return url.toString();
}

module.exports = { createTerminalToken, verifyTerminalToken, createTerminalUrl, tokenFingerprint };