'use strict';
const crypto=require('node:crypto'),fs=require('node:fs'),path=require('node:path');
const cleanUser=u=>({id:u.id,username:u.username,displayName:u.displayName,role:u.role,enabled:u.enabled,createdAt:u.createdAt});
function hash(password,salt=crypto.randomBytes(16).toString('base64url')){return new Promise((resolve,reject)=>crypto.scrypt(password,salt,64,(e,key)=>e?reject(e):resolve(`${salt}:${key.toString('base64url')}`)));}
function verify(password,encoded){const [salt,value]=encoded.split(':');return new Promise((resolve,reject)=>crypto.scrypt(password,salt,64,(e,key)=>e?reject(e):resolve(crypto.timingSafeEqual(key,Buffer.from(value,'base64url')))));}
class UserStore { constructor(file){this.file=file;this.data={users:[]};try{this.data=JSON.parse(fs.readFileSync(file,'utf8'));}catch{} }
 save(){fs.mkdirSync(path.dirname(this.file),{recursive:true});fs.writeFileSync(this.file,JSON.stringify(this.data,null,2),{mode:0o600});}
 list(){return this.data.users.map(cleanUser)} get(id){const u=this.data.users.find(x=>x.id===id);return u&&cleanUser(u)} find(username){return this.data.users.find(x=>x.username===String(username).toLowerCase())}
 async create({username,displayName,password,role='user'}){username=String(username||'').trim().toLowerCase();if(!/^[a-z0-9_.-]{3,40}$/.test(username))throw Error('invalid-username');if(typeof password!=='string'||password.length<12)throw Error('password-must-be-at-least-12-characters');if(this.find(username))throw Error('duplicate-username');const u={id:crypto.randomUUID(),username,displayName:String(displayName||username).trim().slice(0,80),role:role==='admin'?'admin':'user',enabled:true,createdAt:Date.now(),passwordHash:await hash(password)};this.data.users.push(u);this.save();return cleanUser(u)}
 async authenticate(username,password){const u=this.find(username);if(!u||!u.enabled||!await verify(password||'',u.passwordHash))return null;return cleanUser(u)}
 update(id,patch){const u=this.data.users.find(x=>x.id===id);if(!u) return null;if('enabled'in patch)u.enabled=!!patch.enabled; if('displayName'in patch)u.displayName=String(patch.displayName).slice(0,80);this.save();return cleanUser(u)}
 async changePassword(id,currentPassword,newPassword){const u=this.data.users.find(x=>x.id===id);if(!u||!u.enabled||!await verify(currentPassword||'',u.passwordHash))throw Error('current-password-invalid');if(typeof newPassword!=='string'||newPassword.length<12)throw Error('password-must-be-at-least-12-characters');u.passwordHash=await hash(newPassword);this.save();return cleanUser(u)} }
module.exports={UserStore};
