'use strict';
const fs=require('node:fs'),path=require('node:path');const banned=new Set(['.env','.env.local']);
function walk(dir){for(const e of fs.readdirSync(dir,{withFileTypes:true})){const p=path.join(dir,e.name);if(banned.has(e.name))throw new Error(`excluded file present: ${p}`);if(e.isDirectory()&&!['.git','node_modules','logs'].includes(e.name))walk(p);}}walk(process.cwd());console.log('package check passed: no local .env files found; exclude logs and node_modules when archiving');
