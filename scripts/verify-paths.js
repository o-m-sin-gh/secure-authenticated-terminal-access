'use strict';
const fs = require('node:fs');
const pkg = require('../package.json');
const required = ['src/multi-user-gateway.js', 'src/session-manager.js', 'src/session-store.js', 'src/token.js', 'test/token.test.js', 'test/gateway.test.js', 'test/isolation.test.js', 'scripts/benchmark.js', 'scripts/package-check.js', 'scripts/package-project.ps1'];
for (const file of required) if (!fs.existsSync(file)) throw new Error(`required project file is missing: ${file}`);
for (const script of Object.values(pkg.scripts)) for (const match of script.matchAll(/(?:node(?:\s+--\S+)*\s+)([\w./-]+\.js)/g)) if (!fs.existsSync(match[1])) throw new Error(`npm script references missing file: ${match[1]}`);
console.log('path verification passed');
