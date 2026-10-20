'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createTerminalToken, verifyTerminalToken } = require('../src/token');

const secret = 'a-32-character-minimum-secret-value!';
test('issues and verifies a session token', () => {
  const token = createTerminalToken({ sessionId: 'session-1', secret, ttlSeconds: 60, now: 1_000_000 });
  const result = verifyTerminalToken(token, { secret, now: 1_030_000 });
  assert.equal(result.ok, true); assert.equal(result.payload.sid, 'session-1');
});
test('rejects expired, modified and absent tokens', () => {
  const token = createTerminalToken({ sessionId: 'session-1', secret, ttlSeconds: 1, now: 1_000_000 });
  assert.equal(verifyTerminalToken(token, { secret, now: 1_002_000 }).reason, 'expired-token');
  assert.equal(verifyTerminalToken(`${token}x`, { secret }).reason, 'invalid-token');
  assert.equal(verifyTerminalToken(undefined, { secret }).reason, 'missing-token');
});
test('rejects wrong token type', () => {
  const t = createTerminalToken({ sessionId: 's', secret, typ: 'session' });
  assert.equal(verifyTerminalToken(t, { secret, typ: 'launch' }).reason, 'wrong-token-type');
});