import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import crypto from 'node:crypto';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
import {Access,atomicJson,passwordHash,digest,secret} from '../portal/access.mjs';
import {backupOffline} from '../scripts/backup.mjs';
const root=path.dirname(path.dirname(fileURLToPath(import.meta.url))),require=createRequire(path.join(root,'.vendor/upstream/package.json')),{WebSocket}=require('ws');
fs.mkdirSync(path.join(root,'.local'),{recursive:true});
const dir=fs.mkdtempSync(path.join(root,'.local/members-test-')),authFile=path.join(dir,'auth.json'),origin='https://boards.test';
const password=secret(),activation=secret(),alexPassword=secret();
atomicJson(authFile,{version:2,users:{alice:{id:'alice',name:'Alice',username:'owner',active:true,...passwordHash(password)},bob:{id:'bob',username:'bob',name:'Bob',active:false}},boards:{},sessions:{},invitations:{},tokens:{},activations:{test:{hash:digest(activation),user:'bob',expires:Date.now()+86400000}}});
fs.writeFileSync(path.join(dir,'boards.json'),'[]');
const reservation=http.createServer();reservation.listen(0,'127.0.0.1');await once(reservation,'listening');const port=reservation.address().port;await new Promise(r=>reservation.close(r));
const base=`http://127.0.0.1:${port}`,env={...process.env,PORT:String(port),PUBLIC_ORIGIN:origin,AUTH_STATE_FILE:authFile,BOARDS_CONFIG:path.join(dir,'boards.json'),PERSONAL_DATA_ROOT:path.join(dir,'personal')};
atomicJson(path.join(dir,'config.json'),{localDemo:false,origin,port,dataRoot:dir,appRoot:path.join(root,'.vendor/upstream')});
env.PORTAL_CONFIG=path.join(dir,'config.json');
let child,errors='',guestSocket,memberSocket;
async function start(){child=spawn(process.execPath,[path.join(root,'portal/server.mjs')],{cwd:root,env,windowsHide:true,stdio:['ignore','pipe','pipe','ipc']});child.stderr.on('data',b=>errors+=b);for(let n=0;n<100;n++){try{if((await fetch(base+'/health')).ok)return;}catch{}await new Promise(r=>setTimeout(r,50));}throw new Error(errors||'Portal failed to start');}
async function stop(){if(child?.exitCode===null){const end=once(child,'exit');child.send({type:'portal:shutdown'});await end;}}
async function call(url,{cookie,token,method='GET',body,requestOrigin=origin}={}){
  const headers={Origin:requestOrigin};if(cookie)headers.Cookie=cookie;if(token)headers.Authorization='Bearer '+token;if(body!==undefined)headers['Content-Type']='application/json';
  const response=await fetch(base+url,{method,headers,redirect:'manual',body:body===undefined?undefined:JSON.stringify(body)});const text=await response.text();let data;try{data=JSON.parse(text);}catch{data=text;}
  return {status:response.status,data,cookie:response.headers.get('set-cookie')?.split(';')[0]};
}
let seq=0;async function rpc(token,method,params={}){const r=await call('/mcp',{token,method:'POST',body:{jsonrpc:'2.0',id:++seq,method,params}});assert.equal(r.status,200,JSON.stringify(r.data));return r.data;}
async function tool(token,name,args={}){return (await rpc(token,'tools/call',{name,arguments:args})).result;}
try{
  await start();
  const owner=await call('/api/login',{method:'POST',body:{username:'owner',password}});assert.equal(owner.status,200);const d=owner.cookie;
  assert.equal((await call('/api/boards')).status,401);
  assert.equal((await call('/api/activate',{method:'POST',body:{token:activation,password:alexPassword}})).status,200);
  assert.equal((await call('/api/activate',{method:'POST',body:{token:activation,password:alexPassword}})).status,410);
  const alex=(await call('/api/login',{method:'POST',body:{username:'bob',password:alexPassword}})).cookie;assert(alex);
  const dt=(await call('/api/tokens',{cookie:d,method:'POST',body:{label:'D test'}})).data;
  const at=(await call('/api/tokens',{cookie:alex,method:'POST',body:{label:'A test'}})).data;
  const disk=fs.readFileSync(authFile,'utf8');assert(!disk.includes(dt.token)&&!disk.includes(at.token)&&!disk.includes(password)&&!disk.includes(activation));
  const db=(await call('/api/boards',{cookie:d,method:'POST',body:{name:'D private'}})).data;
  const ab=JSON.parse((await tool(at.token,'create_board',{name:'A private'})).content[0].text);assert(ab.id);
  assert.equal((await call('/api/boards',{cookie:alex})).data.length,1);
  assert.equal((await call(`/b/${ab.id}/api/elements`,{cookie:d})).status,403);
  assert((await tool(at.token,'query_elements',{board:db.id})).isError);
  assert((await tool(dt.token,'query_elements',{})).isError);
  assert((await tool(dt.token,'import_scene',{board:db.id,filePath:authFile,mode:'replace'})).isError);
  assert.equal((await call(`/api/boards/${db.id}/access`,{cookie:alex,method:'PUT',body:{user:'bob',role:'edit'}})).status,403);
  assert.equal((await call(`/api/boards/${db.id}/access`,{cookie:d,method:'PUT',requestOrigin:'https://wrong.test',body:{user:'bob',role:'edit'}})).status,403);
  assert.equal((await call(`/api/boards/${db.id}/access`,{cookie:d,method:'PUT',body:{user:'bob',role:'view'}})).status,200);
  assert.equal((await call('/api/boards',{cookie:alex})).data.length,2);
  const init=await rpc(at.token,'initialize',{protocolVersion:'2025-06-18'});assert.equal(init.result.protocolVersion,'2025-06-18');
  assert((await rpc(at.token,'tools/list')).result.tools.some(t=>t.name==='create_board'));
  assert(!(await tool(at.token,'query_elements',{board:db.id})).isError);
  assert((await tool(at.token,'create_element',{board:db.id,type:'rectangle',x:0,y:0})).isError);
  assert.equal((await call(`/b/${db.id}/api/elements`,{cookie:alex,method:'POST',body:{type:'rectangle',x:0,y:0}})).status,403);
  await call(`/api/boards/${db.id}/access`,{cookie:d,method:'PUT',body:{user:'bob',role:'edit'}});
  assert(!(await tool(at.token,'create_element',{board:db.id,id:'shared-test',type:'rectangle',x:10,y:20,width:100,height:80})).isError);
  const scene=(await call(`/b/${db.id}/api/elements`,{cookie:d})).data;assert.equal(scene.elements.length,1);
  assert(!(await tool(at.token,'snapshot_scene',{board:db.id,name:'Before restart'})).isError);
  const svg=await tool(at.token,'export_to_image',{board:db.id,format:'svg'});assert(!svg.isError,JSON.stringify(svg));assert(svg.content[0].text.includes('<svg'));
  assert(!(await tool(at.token,'create_element',{board:ab.id,id:'alex-only',type:'text',x:0,y:0,text:'Private'})).isError);
  assert(!(await tool(dt.token,'create_element',{board:db.id,id:'owner-test',type:'text',x:0,y:0,text:'Shared'})).isError);
  const inv=(await call('/api/invitations',{cookie:d,method:'POST',body:{board:db.id,days:1}})).data;
  const guest=(await call('/api/invitations/redeem',{method:'POST',body:{token:new URL(inv.url).hash.slice(1)}})).cookie;
  assert.equal((await call('/api/boards',{cookie:guest})).status,403);
  guestSocket=new WebSocket(`ws://127.0.0.1:${port}/b/${db.id}/ws`,{origin,headers:{Cookie:guest}});await once(guestSocket,'message');
  const closed=once(guestSocket,'close');await call('/api/invitations/'+inv.id,{cookie:d,method:'DELETE'});assert.equal((await closed)[0],1008);
  memberSocket=new WebSocket(`ws://127.0.0.1:${port}/b/${db.id}/ws`,{origin,headers:{Cookie:alex}});await once(memberSocket,'message');
  const memberClosed=once(memberSocket,'close');
  await call(`/api/boards/${db.id}/access`,{cookie:d,method:'PUT',body:{user:'bob',role:'none'}});
  assert.equal((await memberClosed)[0],1008);
  assert((await tool(at.token,'query_elements',{board:db.id})).isError);
  assert.equal((await call(`/b/${db.id}/api/elements`,{cookie:alex})).status,403);
  await call(`/api/boards/${ab.id}/access`,{cookie:alex,method:'PUT',body:{user:'alice',role:'edit'}});
  assert.equal((await call(`/b/${ab.id}/api/elements`,{cookie:d})).data.elements[0].id,'alex-only');
  const png='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jz1QAAAAASUVORK5CYII=';
  assert.equal((await call(`/b/${db.id}/api/files`,{cookie:d,method:'POST',body:[{id:'fixture-image',dataURL:png,mimeType:'image/png',created:1}]})).status,200);
  const current=(await call(`/b/${db.id}/api/elements`,{cookie:d})).data.elements;
  assert.equal((await call(`/b/${db.id}/api/elements/sync`,{cookie:d,method:'POST',body:{elements:[...current,{id:'fixture-image-element',type:'image',x:150,y:10,width:64,height:64,fileId:'fixture-image',status:'saved',scale:[1,1]}]}})).status,200);
  assert(!(await tool(dt.token,'snapshot_scene',{board:db.id,name:'With image'})).isError);
  const rendered=await tool(dt.token,'get_canvas_screenshot',{board:db.id});assert(!rendered.isError,JSON.stringify(rendered));assert(rendered.content.some(c=>c.type==='image'));
  await stop();await start();
  assert.equal((await call('/api/boards',{cookie:alex})).data.length,1);
  assert.equal((await call(`/b/${ab.id}/api/elements`,{cookie:alex})).data.elements[0].id,'alex-only');
  assert.equal((await call(`/b/${db.id}/api/elements`,{cookie:d})).data.elements.length,3);
  assert.equal((await call(`/b/${db.id}/api/files`,{cookie:d})).data.files['fixture-image'].dataURL,png);
  assert(!(await tool(dt.token,'query_elements',{board:db.id})).isError);
  await call('/api/tokens/'+at.id,{cookie:alex,method:'DELETE'});
  assert.equal((await call('/mcp',{token:at.token,method:'POST',body:{jsonrpc:'2.0',id:1,method:'tools/list'}})).status,401);
  assert.equal((await call('/api/boards',{cookie:alex})).status,200);
  await stop();const beforeBackup=fs.readFileSync(authFile,'utf8'),restored=path.join(root,'.local','restored-'+crypto.randomUUID());backupOffline({dataDir:dir,outDir:restored});
  atomicJson(path.join(restored,'config.json'),{localDemo:false,origin,port,dataRoot:restored,appRoot:path.join(root,'.vendor/upstream')});env.PORTAL_CONFIG=path.join(restored,'config.json');await start();
  assert.equal((await call(`/b/${db.id}/api/files`,{cookie:d})).data.files['fixture-image'].dataURL,png);assert(!(await tool(dt.token,'get_canvas_screenshot',{board:db.id})).isError);
  assert.equal(fs.readFileSync(authFile,'utf8'),beforeBackup,'restoring into another directory changed the original');
  console.log('PASS: existing v2, isolation, HTTP/MCP/WS rights, revocation, restart, image and PNG render, snapshots, offline backup and independent restore');
}finally{
  guestSocket?.terminate();memberSocket?.terminate();await stop();
  // The disposable test workspace is retained for diagnosis until explicitly cleaned.
  console.log('Test workspace:',path.relative(root,dir));
}
