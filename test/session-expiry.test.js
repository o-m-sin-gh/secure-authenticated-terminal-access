'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { MemorySessionStore } = require('../src/session-store');

test('expired sessions are denied and marked expired', () => {
  let now = 1000;
  const store = new MemorySessionStore({ now: () => now });

  const created = store.create({ expiresAt: 2000 });
  store.activate(created.id, 'test-container', {
    host: '127.0.0.1',
    port: 7681
  });

  // Before expiry, the active session should be authorized.
  assert.equal(store.authorize(created.id).ok, true);

  // Advance the simulated clock to the expiry time.
  now = 2000;

  const result = store.authorize(created.id);
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'expired-session');
  assert.equal(store.get(created.id).status, 'expired');

  // It must remain denied on subsequent requests.
  const repeated = store.authorize(created.id);
  assert.equal(repeated.ok, false);
  assert.equal(repeated.reason, 'expired-session');
});
