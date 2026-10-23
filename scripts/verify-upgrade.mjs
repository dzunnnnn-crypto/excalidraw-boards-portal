// Integration rehearsal on synthetic data. Never point this at a running service.
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import http from 'node:http';import {spawn} from 'node:child_process';import {once} from 'node:events';import {pathToFileURL} from 'node:url';import assert from 'node:assert/strict';
if(process.platform!=='linux')throw new Error('Run this release rehearsal in isolated Linux');
const arg=n=>{const i=process.argv.indexOf(n);if(i<0)throw new Error(`Required ${n}`);return path.resolve(process.argv[i+1]);};
const previous=arg('--previous'),candidate=arg('--candidate'),engine=path.join(candidate,'.vendor/upstream');
const {atomicJson,passwordHash,secret}=await import(pathToFileURL(path.join(candidate,'portal/access.mjs')));
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'boards-upgrade-'));
const freePort=async()=>{const s=http.createServer();s.listen(0,'127.0.0.1');await once(s,'listening');const p=s.address().port;await new Promise(r=>s.close(r));return p;};
const port=await freePort(),fixedPort=await freePort(),origin='https://boards.test',base=`http://127.0.0.1:${port}`;
const authFile=path.join(dir,'auth.json'),password=secret(),bobPassword=secret();
const board={id:'legacy-project',name:'Existing project',owner:'alice',grants:{bob:'edit'},sections:[],port:fixedPort};
atomicJson(authFile,{version:2,users:{alice:{id:'alice',username:'alice',name:'Alice',active:true,...passwordHash(password)},bob:{id:'bob',username:'bob',name:'Bob',active:true,...passwordHash(bobPassword)}},boards:{[board.id]:board},sessions:{},invitations:{},tokens:{},activations:{}});
atomicJson(path.join(dir,'boards.json'),[board]);const config=path.join(dir,'config.json');
atomicJson(config,{localDemo:false,origin,port,dataRoot:dir,authStateFile:authFile,appRoot:engine});
const env={...process.env,PORTAL_CONFIG:config,PORT:String(port),PUBLIC_ORIGIN:origin,AUTH_STATE_FILE:authFile,BOARDS_CONFIG:path.join(dir,'boards.json'),PERSONAL_DATA_ROOT:path.join(dir,'personal'),EXCALIDRAW_APP_ROOT:engine};
let portal,fixed,output='';
async function healthy(url,child){for(let i=0;i<160;i++){if(child.exitCode!==null||child.signalCode)throw new Error('Process exited: '+output);try{if((await fetch(url+'/health',{signal:AbortSignal.timeout(500)})).ok)return;}catch{}await new Promise(r=>setTimeout(r,50));}throw new Error('Health timeout: '+output);}
function processAt(file,cwd,environment){const child=spawn(process.execPath,[file],{cwd,env:environment,stdio:['ignore','pipe','pipe','ipc']});child.stdout.on('data',b=>{output=(output+b).slice(-4000);});child.stderr.on('data',b=>{output=(output+b).slice(-4000);});return child;}
async function start(root){portal=processAt(path.join(root,'portal/server.mjs'),root,env);await healthy(base,portal);}
async function stop(child){if(!child||child.exitCode!==null||child.signalCode)return;const end=once(child,'exit');child.kill('SIGTERM');let timer;await Promise.race([end,new Promise((_,reject)=>{timer=setTimeout(()=>{child.kill('SIGKILL');reject(new Error('Graceful shutdown timeout'));},6000);})]).finally(()=>clearTimeout(timer));}
async function call(url,{cookie,token,method='GET',body}={}){const headers={Origin:origin};if(cookie)headers.Cookie=cookie;if(token)headers.Authorization='Bearer '+token;if(body!==undefined)headers['Content-Type']='application/json';const r=await fetch(base+url,{method,headers,body:body===undefined?undefined:JSON.stringify(body),redirect:'manual'});const text=await r.text();let data;try{data=JSON.parse(text);}catch{data=text;}return {status:r.status,data,cookie:r.headers.get('set-cookie')?.split(';')[0]};}
let seq=0;const rpc=(token,name,args)=>call('/mcp',{token,method:'POST',body:{jsonrpc:'2.0',id:++seq,method:'tools/call',params:{name,arguments:args}}});
try{
 fs.mkdirSync(path.join(dir,'fixed'),{recursive:true});fixed=processAt(path.join(engine,'dist/server.js'),engine,{...process.env,HOST:'127.0.0.1',PORT:String(fixedPort),BOARD_ID:board.id,EXCALIDRAW_DATA_DIR:path.join(dir,'fixed'),XDG_STATE_HOME:path.join(dir,'runtime')});await healthy(`http://127.0.0.1:${fixedPort}`,fixed);
 await start(previous);const owner=await call('/api/login',{method:'POST',body:{username:'alice',password}});assert.equal(owner.status,200);const cookie=owner.cookie;
 const key=(await call('/api/tokens',{cookie,method:'POST',body:{label:'Before update'}})).data;
 const bob=(await call('/api/login',{method:'POST',body:{username:'bob',password:bobPassword}})).cookie;
 const bobKey=(await call('/api/tokens',{cookie:bob,method:'POST',body:{label:'Revoke during update'}})).data;
 const dynamic=(await call('/api/boards',{cookie,method:'POST',body:{name:'Created before update'}})).data;assert(dynamic.id);
 const png='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jz1QAAAAASUVORK5CYII=';
 assert.equal((await call(`/b/${board.id}/api/files`,{cookie,method:'POST',body:[{id:'before-image',dataURL:png,mimeType:'image/png',created:1}]})).status,200);
 assert.equal((await call(`/b/${board.id}/api/elements/sync`,{cookie,method:'POST',body:{elements:[{id:'before-image-element',type:'image',x:0,y:0,width:50,height:50,fileId:'before-image',status:'saved',scale:[1,1]}]}})).status,200);
 const inv=(await call('/api/invitations',{cookie,method:'POST',body:{board:board.id,days:1}})).data;
 const guest=(await call('/api/invitations/redeem',{method:'POST',body:{token:new URL(inv.url).hash.slice(1)}})).cookie;
 const snap=await rpc(key.token,'snapshot_scene',{board:board.id,name:'Before update'});assert(!snap.data.result.isError);
 await stop(portal);await start(candidate);
 assert.equal((await call('/api/boards',{cookie})).data.length,2);assert.equal((await call(`/b/${board.id}/api/elements`,{cookie:guest})).status,200);
 assert.equal((await call(`/b/${board.id}/api/files`,{cookie})).data.files['before-image'].dataURL,png);
 const draw=await rpc(key.token,'get_canvas_screenshot',{board:board.id});assert(!draw.data.result.isError);assert(draw.data.result.content.some(c=>c.type==='image'));
 const dynamicDraw=await rpc(key.token,'create_element',{board:dynamic.id,id:'during-update',type:'text',x:10,y:10,text:'Created on B'});assert(!dynamicDraw.data.result.isError);
 const newKey=(await call('/api/tokens',{cookie,method:'POST',body:{label:'Created on B'}})).data;
 await call('/api/tokens/'+bobKey.id,{cookie:bob,method:'DELETE'});await call('/api/invitations/'+inv.id,{cookie,method:'DELETE'});
 await stop(portal);await start(previous);
 assert.equal((await call('/api/boards',{cookie})).data.length,2);assert.equal((await call(`/b/${dynamic.id}/api/elements`,{cookie})).data.elements[0].id,'during-update');
 assert.equal((await call(`/b/${board.id}/api/files`,{cookie})).data.files['before-image'].dataURL,png);
 assert.equal((await rpc(newKey.token,'query_elements',{board:board.id})).status,200);assert.equal((await rpc(bobKey.token,'query_elements',{board:board.id})).status,401);
 assert.notEqual((await call(`/b/${board.id}/api/elements`,{cookie:guest})).status,200);
 assert.equal(JSON.parse(fs.readFileSync(authFile)).version,2);
 console.log('PASS: A -> Linux release B -> A; IDs, fixed+dynamic boards, images, snapshots, sessions, keys and revocations survive without restoring old auth.');
}finally{await stop(portal);await stop(fixed);console.log('Synthetic rehearsal state retained outside Git:',dir);}
