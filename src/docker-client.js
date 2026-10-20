'use strict';

const http = require('node:http');

class DockerClient {
  constructor(socketPath) { this.socketPath = socketPath; }
  request(method, path, body) {
    return new Promise((resolve, reject) => {
      const payload = body === undefined ? undefined : JSON.stringify(body);
      const req = http.request({ socketPath: this.socketPath, method, path, headers: payload ? { 'content-type': 'application/json', 'content-length': Buffer.byteLength(payload) } : {} }, res => {
        let data = ''; res.setEncoding('utf8'); res.on('data', d => data += d); res.on('end', () => {
          let parsed; try { parsed = data ? JSON.parse(data) : {}; } catch { parsed = {}; }
          if (res.statusCode >= 200 && res.statusCode < 300) resolve(parsed);
          else reject(Object.assign(new Error(`docker-${res.statusCode}`), { statusCode: res.statusCode, body: parsed }));
        });
      });
      req.on('error', reject); if (payload) req.write(payload); req.end();
    });
  }
}
module.exports = { DockerClient };
