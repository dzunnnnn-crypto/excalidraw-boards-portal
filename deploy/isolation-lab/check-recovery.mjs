import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {randomUUID} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {Workers} from './workers.mjs';
import {sandboxCommand} from './sandbox.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const engine=fs.realpathSync(path.join(root,'.vendor/upstream')),base=path.resolve(process.argv[2]);
fs.mkdirSync(base,{recursive:true});
const results=[];const pass=name=>results.push({name,passed:true});
async function refuse(id,prepare,verify){
  const personal=path.join(base,id),directory=path.join(personal,id);fs.mkdirSync(directory,{recursive:true});
  const context=await prepare({directory,personal,id});const pool=new Workers(engine,personal);
  try{await assert.rejects(pool.acquire({id,name:id}));await verify({directory,personal,id,context});}
  finally{await pool.close();if(context?.close)await context.close();}
}
for(const kind of ['legacy','different-lease','invalid-owner']){
  await refuse(kind,async({directory})=>{
    const lock=path.join(directory,'canvas/canvas-state.lock');fs.mkdirSync(lock,{recursive:true});const token=randomUUID();
    const file=path.join(lock,'owner-'+token+'.json');
    const content=kind==='invalid-owner'?'invalid json':JSON.stringify({pid:99999999,token,...(kind==='different-lease'?{lease:'0:1'}:{})});
    fs.writeFileSync(file,content);return {file,content};
  },async({context})=>assert.equal(fs.readFileSync(context.file,'utf8'),context.content));
  pass(kind+' lock is not reclaimed');
}
await refuse('regular-socket',async({directory})=>{const file=path.join(directory,'editor.sock');fs.writeFileSync(file,'keep');return {file};},
  async({context})=>assert.equal(fs.readFileSync(context.file,'utf8'),'keep'));pass('regular file at socket path preserved');
await refuse('symlink-socket',async({directory})=>{const target=path.join(base,'symlink-target');fs.writeFileSync(target,'keep');const file=path.join(directory,'editor.sock');fs.symlinkSync(target,file);return {file,target};},
  async({context})=>{assert(fs.lstatSync(context.file).isSymbolicLink());assert.equal(fs.readFileSync(context.target,'utf8'),'keep');});pass('symlink socket path and its target preserved');
await refuse('symlink-lease',async({directory,personal,id})=>{const target=path.join(base,'lease-target');fs.writeFileSync(target,'keep');const leases=path.join(personal,'.leases');fs.mkdirSync(leases);const file=path.join(leases,id+'.lock');fs.symlinkSync(target,file);return {file,target};},
  async({context})=>{assert(fs.lstatSync(context.file).isSymbolicLink());assert.equal(fs.readFileSync(context.target,'utf8'),'keep');});pass('symlink kernel lease rejected before launch');

await refuse('hardlink-lease',async({personal,id})=>{const target=path.join(base,'hardlink-target');fs.writeFileSync(target,'keep');const leases=path.join(personal,'.leases');fs.mkdirSync(leases);const file=path.join(leases,id+'.lock');fs.linkSync(target,file);return {file,target};},
  async({context})=>{assert.equal(fs.statSync(context.file).nlink,2);assert.equal(fs.readFileSync(context.target,'utf8'),'keep');});pass('multiply-linked kernel lease rejected before launch');

// An unknown live endpoint must not satisfy readiness simply by claiming the
// same board ID, nor be unlinked by a competing launch or its cleanup.
await refuse('active-foreign',async({directory,id})=>{
  const file=path.join(directory,'editor.sock');const server=http.createServer((req,res)=>res.end(JSON.stringify({id,generation:'old-unknown-worker'})));
  server.listen(file);await once(server,'listening');const inode=fs.lstatSync(file).ino;
  return {file,server,inode,close:()=>new Promise(r=>server.close(r))};
},async({context})=>{assert.equal(fs.lstatSync(context.file).ino,context.inode);assert(context.server.listening);});pass('active unknown socket preserved and never accepted as new generation');

const directory=path.join(base,'without-flock'),leaseFile=path.join(base,'no-flock.lock');fs.mkdirSync(directory);fs.writeFileSync(leaseFile,'');
const launch=sandboxCommand({engine,directory,id:'without-flock',name:'No flock',leaseFile,command:['/runtime/node','/app/dist/server.js']});
const child=spawn(launch.file,launch.args,launch.options);child.stderr.resume();const [code]=await once(child,'exit');
assert.notEqual(code,0);assert(!fs.existsSync(path.join(directory,'editor.sock')));assert(!fs.existsSync(path.join(directory,'canvas/canvas-state.lock')));pass('native editor refuses claimed isolation without holding kernel lease');

const concurrent=[new Workers(engine,path.join(base,'concurrent')),new Workers(engine,path.join(base,'concurrent'))];
try{
  const attempts=await Promise.allSettled(concurrent.map(p=>p.acquire({id:'same',name:'Concurrent initial start'})));
  assert.equal(attempts.filter(r=>r.status==='fulfilled').length,1);
  assert.equal(attempts.filter(r=>r.status==='rejected').length,1);
  attempts.find(r=>r.status==='fulfilled').value.release();pass('two initial managers racing for one board produce exactly one writer');
}finally{await Promise.all(concurrent.map(p=>p.close()));}
console.log(JSON.stringify({tests:results.length,results},null,2));
