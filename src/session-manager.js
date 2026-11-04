'use strict';

const { DockerClient } = require('./docker-client');
const http = require('node:http');

class SessionManager {
  constructor({ store, audit = () => {}, docker = new DockerClient(process.env.DOCKER_SOCKET || '/var/run/docker.sock'), image, network, command, memoryMb = 256, cpu = 500000000, pids = 128 }) {
    if (!image || !network) throw new Error('terminal image and network are required');
    this.store = store; this.audit = audit; this.docker = docker; this.image = image; this.network = network;
    this.command = command; this.memory = memoryMb * 1024 * 1024; this.cpu = cpu; this.pids = pids;
  }
  async create(ttlSeconds) {
    const expiresAt = Date.now() + ttlSeconds * 1000;
    const session = this.store.create({ expiresAt });
    try {
      // No client-provided image, name, command, ports, volumes, or capabilities enter this request.
      const created = await this.docker.request('POST', '/v1.43/containers/create', {
        Image: this.image, Cmd: this.command, User: '1000:1000', WorkingDir: '/home/terminal',
        Labels: { 'secure-terminal.managed': 'true', 'secure-terminal.session': session.id },
        HostConfig: { NetworkMode: this.network, ReadonlyRootfs: true, CapDrop: ['ALL'], SecurityOpt: ['no-new-privileges:true'], PidsLimit: this.pids, Memory: this.memory, NanoCpus: this.cpu, AutoRemove: false, PortBindings: {}, Tmpfs: { '/tmp': 'rw,noexec,nosuid,size=64m' } }
      });
      await this.docker.request('POST', `/v1.43/containers/${created.Id}/start`);
      const inspected = await this.docker.request('GET', `/v1.43/containers/${created.Id}/json`);
      const ip = inspected.NetworkSettings?.Networks?.[this.network]?.IPAddress;
      if (!ip) throw new Error('terminal-network-address-missing');
      await this.waitForReady(ip);
      const active = this.store.activate(session.id, created.Id, { host: ip, port: 7681 });
      this.audit({ outcome: 'session-created', sessionId: session.id, containerId: created.Id });
      return active;
    } catch (error) {
      this.store.fail(session.id); this.audit({ outcome: 'container-start-failed', sessionId: session.id, reason: error.message });
      throw error;
    }
  }
  async terminate(id, reason = 'revoked') {
    const session = this.store.revoke(id, reason);
    if (!session) return null;
    if (session.containerId) {
      try { await this.docker.request('POST', `/v1.43/containers/${session.containerId}/stop?t=5`); } catch {}
      try { await this.docker.request('DELETE', `/v1.43/containers/${session.containerId}?force=1`); } catch (error) { this.audit({ outcome: 'container-cleanup-failed', sessionId: id, reason: error.message }); }
    }
    this.audit({ outcome: 'session-terminated', sessionId: id, reason });
    return session;
  }
  async waitForReady(host) {
    const deadline = Date.now() + 15_000;
    while (Date.now() < deadline) {
      const ready = await new Promise(resolve => {
        const req = http.get({ host, port: 7681, path: '/', timeout: 1000 }, res => { res.resume(); resolve(res.statusCode >= 200 && res.statusCode < 500); });
        req.on('timeout', () => { req.destroy(); resolve(false); }); req.on('error', () => resolve(false));
      });
      if (ready) return;
      await new Promise(resolve => setTimeout(resolve, 250));
    }
    throw new Error('terminal-readiness-timeout');
  }
  async cleanupExpired() { for (const s of this.store.sessions.values()) if (['creating', 'active'].includes(s.status) && s.expiresAt <= Date.now()) await this.terminate(s.id, 'expired'); }
}
module.exports = { SessionManager };
