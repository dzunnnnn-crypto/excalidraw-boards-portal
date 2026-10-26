import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {Workers} from './workers.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const base=path.resolve(process.argv[2]),engine=fs.realpathSync(path.join(root,'.vendor/upstream'));
fs.mkdirSync(base,{recursive:true});
const fixed=[1,2,3].map(n=>({id:'fixed-'+n,name:'Fixed '+n,port:3000+n}));
const dirs=Object.fromEntries(fixed.map(b=>[b.id,path.join(base,b.id)]));
process.env.BOARDS_LAB_FIXED_DIRECTORIES=JSON.stringify(dirs);
const workers=new Workers(engine,path.join(base,'personal'),{maxWorkers:5});
const results=[];function passed(name){results.push({name,passed:true});}
function request(lease,url,method='GET',body){return new Promise((resolve,reject)=>{
  const data=body===undefined?undefined:JSON.stringify(body);
  const req=http.request({socketPath:lease.socketPath,path:url,method,headers:data?{'Content-Type':'application/json','Content-Length':Buffer.byteLength(data)}:{}},res=>{
    let output='';res.on('data',b=>output+=b);res.on('end',()=>{try{resolve({status:res.statusCode,data:JSON.parse(output)});}catch(e){reject(e);}});
  });req.on('error',reject);req.end(data);
});}
let held=[];
try{
  held=await Promise.all([...fixed,{id:'personal-a',name:'A'},{id:'personal-b',name:'B'}].map(b=>workers.acquire(b)));
  assert.equal(new Set(held.map(l=>l.socketPath)).size,5);passed('three fixed and two personal editors concurrently');
  for(let i=0;i<held.length;i++){
    const id=i<3?fixed[i].id:'personal-'+(i===3?'a':'b');
    assert.equal((await request(held[i],'/api/board-config')).data.id,id);
    assert.equal((await request(held[i],'/api/elements','POST',{id:'marker-'+id,type:'rectangle',x:0,y:0,width:20,height:20})).status,200);
    assert.equal((await request(held[i],'/api/elements')).data.elements.length,1);
    assert.equal((await request(held[i],'/api/elements')).data.elements[0].id,'marker-'+id);
  }passed('each editor persists only its own scene');
  assert.notEqual(spawnSync('/usr/bin/flock',['--nonblock',workers.running.get('fixed-1').leaseFile,'true']).status,0);passed('backend holds a real kernel lease visible from host');
  const competitor=new Workers(engine,path.join(base,'personal'),{maxWorkers:5});
  try{await assert.rejects(competitor.acquire(fixed[0]),/lease is busy/);}finally{await competitor.close();}
  assert.equal((await request(held[0],'/api/elements')).data.elements.length,1);passed('independent manager cannot attach to or replace a live editor');
  await assert.rejects(workers.acquire({id:'sixth',name:'Sixth'}),/in use/);passed('active editor limit fails without evicting live boards');
  // Duplicate acquisition reuses the same sandbox instead of starting a writer.
  const second=await workers.acquire(fixed[0]);assert.equal(second.socketPath,held[0].socketPath);second.release();passed('one writer per board');
  held.forEach(l=>l.release());held=[];
  const original=workers.running.get('fixed-1');await workers.stop(original);
  assert(!fs.existsSync(path.join(dirs['fixed-1'],'canvas','canvas-state.lock')));passed('graceful stop releases durable lock');
  const restarted=await workers.acquire(fixed[0]);assert.equal((await request(restarted,'/api/elements')).data.elements[0].id,'marker-fixed-1');restarted.release();passed('restart preserves fixed-board scene');
  await assert.rejects(workers.acquire({id:'unmapped',name:'Unmapped',port:9999}),/approved isolated/);passed('unmapped fixed editor never falls back to TCP');
  // Kernel ownership, not namespace PID liveness, controls crash recovery.
  const crashDirectory=workers.running.get('personal-a').directory;
  const stateBefore=fs.readFileSync(path.join(crashDirectory,'canvas','canvas-state-v1.json'));
  for(let n=0;n<3;n++){
    const crash=workers.running.get('personal-a');const exit=once(crash.child,'exit');crash.child.kill('SIGKILL');await exit;
    const recovered=await workers.acquire({id:'personal-a',name:'A'});
    assert.equal((await request(recovered,'/api/elements')).data.elements[0].id,'marker-personal-a');recovered.release();
    assert.deepEqual(fs.readFileSync(path.join(crashDirectory,'canvas','canvas-state-v1.json')),stateBefore);
  }passed('three consecutive SIGKILL recoveries preserve committed state automatically');
  await workers.close();
  assert.equal(workers.running.size,0);passed('normal shutdown reaps remaining sandboxes');
  console.log(JSON.stringify({tests:results.length,results,crashRecovery:'automatic under verified kernel lease; unknown legacy owners are never removed'},null,2));
}finally{held.forEach(l=>l.release());await workers.close();}
