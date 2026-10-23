import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';import os from 'node:os';import {pathToFileURL} from 'node:url';
const root=path.resolve(import.meta.dirname,'..');
test('local HTTP is explicit and loopback-only; production keeps secure cookies',async()=>{
 const file=path.join(root,'portal/config.mjs');assert(fs.existsSync(file),'configuration module is required');const {loadConfig}=await import(pathToFileURL(file));
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'boards-config-'));const configPath=path.join(dir,'config.json');
 const load=c=>{fs.writeFileSync(configPath,JSON.stringify(c));return loadConfig({root:dir,configPath,env:{}});};
 assert.throws(()=>loadConfig({root:dir,configPath:path.join(dir,'missing'),env:{}}),/config/i);
 const c=load({localDemo:true,origin:'http://127.0.0.1:8805'});assert.equal(c.cookieName,'board_session_dev');assert.equal(c.secureCookies,false);
 for(const origin of ['http://example.org:8805','http://localhost.evil:8805','http://127.0.0.1:1/else'])assert.throws(()=>load({localDemo:true,origin}));
 assert.throws(()=>load({localDemo:true,origin:'http://localhost:8805',host:'0.0.0.0'}));
 const prod=load({localDemo:false,origin:'https://boards.example.org',authStateFile:'/external/auth.json'});assert.equal(prod.cookieName,'__Host-board_session');assert.equal(prod.secureCookies,true);
 assert.throws(()=>load({localDemo:false,origin:'http://127.0.0.1:8805'}));
});
test('demo initializes v2 once, secrets are hashed and live config is never initialized',async()=>{
 const file=path.join(root,'scripts/init-demo.mjs');assert(fs.existsSync(file),'demo initializer is required');const {initDemo}=await import(pathToFileURL(file));
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'boards-init-'));const r=initDemo({root:dir});const text=fs.readFileSync(r.authStateFile,'utf8');const state=JSON.parse(text);
 assert.equal(state.version,2);assert(state.users.alice.active);assert(state.users.bob.active);assert.equal(Object.keys(state.boards).length,1);
 const seeded=JSON.parse(fs.readFileSync(path.join(r.personalDataRoot,'b-demo-project/canvas/canvas-state-v1.json')));assert.deepEqual(Object.keys(seeded).sort(),['elements','files','schemaVersion','snapshots']);assert(seeded.elements.length>0);
 const creds=JSON.parse(fs.readFileSync(path.join(dir,'.local/demo-credentials.json')));assert(!text.includes(creds.alice));assert(!text.includes(creds.bob));assert.notEqual(creds.alice,creds.bob);
 assert.throws(()=>initDemo({root:dir}),/exists|initialized/i);assert.equal(fs.readFileSync(r.authStateFile,'utf8'),text);
});
test('only one portal can own an authentication store',async()=>{
 const file=path.join(root,'portal/store-lock.mjs');assert(fs.existsSync(file),'store lock is required');const {lockStore}=await import(pathToFileURL(file));const dir=fs.mkdtempSync(path.join(os.tmpdir(),'boards-lock-'));const release=lockStore(path.join(dir,'auth.json'));
 assert.throws(()=>lockStore(path.join(dir,'auth.json')),/active|running/i);release();const again=lockStore(path.join(dir,'auth.json'));again();
});
