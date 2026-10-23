import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import {pathToFileURL} from 'node:url';
import {initDemo} from '../scripts/init-demo.mjs';import {lockStore} from '../portal/store-lock.mjs';import {Workers} from '../portal/workers.mjs';import {Access,atomicJson} from '../portal/access.mjs';
const root=path.resolve(import.meta.dirname,'..'),tmp=()=>fs.mkdtempSync(path.join(os.tmpdir(),'boards-review-'));
test('missing config never permits overwriting existing scene or metadata',()=>{
 const dir=tmp(),scene=path.join(dir,'.local/personal/b-demo-project/canvas/canvas-state-v1.json');fs.mkdirSync(path.dirname(scene),{recursive:true});fs.writeFileSync(scene,'existing work');assert.throws(()=>initDemo({root:dir}),/exists|data/i);assert.equal(fs.readFileSync(scene,'utf8'),'existing work');assert(!fs.existsSync(path.join(dir,'config.local.json')));
});
test('stale lock cleanup never unlinks a replacement owner',t=>{
 const dir=tmp(),auth=path.join(dir,'auth.json'),file=path.join(dir,'.portal.lock');lockStore(auth);
 const directory=fs.lstatSync(file).isDirectory(),ownerPath=directory?path.join(file,fs.readdirSync(file)[0]):file;
 const owner=JSON.parse(fs.readFileSync(ownerPath));owner.pid=2147483647;fs.writeFileSync(ownerPath,JSON.stringify(owner));const unlink=fs.unlinkSync;let inserted=false,release;
 t.mock.method(fs,'unlinkSync',p=>{if(p===ownerPath&&!inserted){inserted=true;unlink(p);if(directory)fs.rmdirSync(file);release=lockStore(auth);}return unlink(p);});
 assert.throws(()=>lockStore(auth),/active|running/i);release?.();
});
test('closing workers rejects queued and later acquisition',async()=>{
 const w=new Workers('/unused','/unused');let launches=0;w.start=async()=>{launches++;return 1;};const queued=w.acquire({id:'late'});const closing=w.close();await Promise.allSettled([queued,closing]);assert.equal(launches,0);await assert.rejects(w.acquire({id:'later'}),/closing|closed/i);
});
test('rights and token revocation are rechecked after waiting for worker',async()=>{
 const file=path.join(root,'portal/proxy-access.mjs');assert(fs.existsSync(file),'post-acquire authorization helper is required');const {acquireAuthorizedWorker}=await import(pathToFileURL(file));
 for(const kind of ['view','none','token']){
 const dir=tmp(),stateFile=path.join(dir,'auth.json');atomicJson(stateFile,{version:2,users:{a:{id:'a',active:true},b:{id:'b',active:true}},boards:{one:{id:'one',owner:'a',grants:{b:'edit'}}},sessions:{},tokens:{key:{revoked:false}},invitations:{},activations:{}});const access=new Access(stateFile,[]);const session={user:'b',expires:Date.now()+10000,tokenId:'key'},board=access.board('one');let ready,releases=0;const workers={acquire:()=>new Promise(r=>ready=r)};const job=acquireAuthorizedWorker({workers,access,session,board,write:true});
 if(kind==='token')access.state.tokens.key.revoked=true;else if(kind==='view')board.grants.b='view';else delete board.grants.b;
 ready({port:1,release:()=>releases++});await assert.rejects(job);assert.equal(releases,1);
 }
});
