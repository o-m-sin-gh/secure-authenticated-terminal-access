'use strict';

const crypto = require('node:crypto');

// Development store. Its synchronous methods make check-and-consume atomic in
// one Node process. Replace with Redis transactions before running replicas.
class MemorySessionStore {
  constructor({ maxActive = 10, now = () => Date.now() } = {}) {
    this.maxActive = maxActive;
    this.now = now;
    this.sessions = new Map();
    this.usedLaunch = new Map();
  }

  create({ expiresAt }) {
    this.cleanup();
    if (this.activeCount() >= this.maxActive) throw new Error('session-limit-reached');
    const id = crypto.randomUUID();
    const session = { id, status: 'creating', createdAt: this.now(), expiresAt, containerId: null, target: null, terminatedAt: null };
    this.sessions.set(id, session);
    return { ...session };
  }

  get(id) { const s = this.sessions.get(id); return s && { ...s }; }
  activeCount() { return [...this.sessions.values()].filter(s => ['creating', 'active'].includes(s.status)).length; }
  activate(id, containerId, target) { return this.transition(id, ['creating'], 'active', { containerId, target }); }
  fail(id) { return this.transition(id, ['creating'], 'failed', { terminatedAt: this.now() }); }
  revoke(id, reason = 'revoked') { return this.transition(id, ['creating', 'active'], reason, { terminatedAt: this.now() }); }
  transition(id, allowed, status, extra = {}) {
    const s = this.sessions.get(id);
    if (!s || !allowed.includes(s.status)) return null;
    Object.assign(s, { status, ...extra });
    return { ...s };
  }
  authorize(id) {
    const s = this.sessions.get(id);
    if (!s) return { ok: false, reason: 'unknown-session' };
    if (s.expiresAt <= this.now()) { this.revoke(id, 'expired'); return { ok: false, reason: 'expired-session' }; }
    if (s.status !== 'active') return { ok: false, reason: s.status === 'revoked' ? 'revoked-session' : 'inactive-session' };
    return { ok: true, session: { ...s } };
  }
  consumeLaunch(jti, expiresAt, sessionId) {
    this.cleanup();
    if (this.usedLaunch.has(jti)) return false;
    this.usedLaunch.set(jti, { expiresAt, sessionId });
    return true;
  }
  cleanup() {
    const now = this.now();
    for (const [jti, data] of this.usedLaunch) if (data.expiresAt * 1000 <= now) this.usedLaunch.delete(jti);
  }
}

module.exports = { MemorySessionStore };
