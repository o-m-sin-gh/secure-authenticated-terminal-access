'use strict';
const path=require('node:path');const {UserStore}=require('../src/admin-store');
const [username,password,displayName=username]=process.argv.slice(2);
if(!username||!password){console.error('Usage: node scripts/create-admin.js <username> <password> [display name]');process.exit(1)}
new UserStore(process.env.USER_STORE_PATH||path.join(process.cwd(),'data','users.json')).create({username,password,displayName,role:'admin'}).then(u=>console.log(`Administrator ${u.username} created.`)).catch(e=>{console.error(e.message);process.exit(1)});
