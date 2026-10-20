const { createTerminalUrl } = require('./src/token');
const [sessionId = 'lab-1', labTtl = '600'] = process.argv.slice(2);
console.log(createTerminalUrl({
  baseUrl: 'http://localhost:8080/',
  sessionId,
  secret: process.env.TERMINAL_TOKEN_SECRET,
  labTtlSeconds: Number(labTtl)
}));