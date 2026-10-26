import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';import http from 'node:http';
import {spawn} from 'node:child_process';import {once} from 'node:events';import {fileURLToPath} from 'node:url';
import {Workers} from './workers.mjs';import {backupOffline} from '../../scripts/backup.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..'),base=path.resolve(process.argv[2]);
const legacyEngine=fs.realpathSync(process.argv[3]),engine=fs.realpathSync(path.join(root,'.vendor/upstream'));
const data=path.join(base,'data'),directory=path.join(data,'legacy'),personal=path.join(data,'personal');fs.mkdirSync(directory,{recursive:true});
const reserve=http.createServer();reserve.listen(0,'127.0.0.1');await once(reserve,'listening');const port=reserve.address().port;await new Promise(r=>reserve.close(r));
const board={id:'legacy',name:'Legacy board',port};process.env.BOARDS_LAB_FIXED_DIRECTORIES=JSON.stringify({legacy:directory});
let plain,pool,lease;const results=[];const pass=name=>results.push({name,passed:true});
const delay=ms=>new Promise(r=>setTimeout(r,ms));
function request(endpoint,url,body){return new Promise((resolve,reject)=>{
 const payload=body===undefined?undefined:JSON.stringify(body);const req=http.request({...endpoint,path:url,method:payload?'POST':'GET',headers:payload?{'Content-Type':'application/json','Content-Length':Buffer.byteLength(payload)}:{}},res=>{
 let output='';res.on('data',b=>output+=b);res.on('end',()=>{try{assert.equal(res.statusCode,200,output);resolve(JSON.parse(output));}catch(e){reject(e);}});
 });req.on('error',reject);req.end(payload);
});}
async function state(endpoint){return {elements:(await request(endpoint,'/api/elements')).elements,files:(await request(endpoint,'/api/files')).files,snapshots:await request(endpoint,'/api/snapshots')};}
async function startPlain(){
 plain=spawn(process.execPath,[path.join(legacyEngine,'dist/server.js')],{cwd:legacyEngine,env:{...process.env,HOST:'127.0.0.1',PORT:String(port),BOARD_ID:board.id,EXCALIDRAW_DATA_DIR:path.join(directory,'canvas'),XDG_STATE_HOME:path.join(base,'runtime'),LOG_FILE_PATH:path.join(base,'legacy.log')},stdio:['ignore','ignore','pipe','ipc']});
 plain.stderr.resume();for(let n=0;n<100;n++){try{if((await request({host:'127.0.0.1',port},'/api/board-config')).id===board.id)return;}catch{}await delay(50);}throw new Error('Legacy editor did not start');
}
async function stopPlain(){if(plain?.exitCode===null){const ended=once(plain,'exit');plain.send({type:'canvas:shutdown'});await ended;}plain=undefined;}
try{
 await startPlain();const tcp={host:'127.0.0.1',port};
 const png='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jz1QAAAAASUVORK5CYII=';
 await request(tcp,'/api/files',[{id:'image',dataURL:png,mimeType:'image/png',created:1}]);
 await request(tcp,'/api/elements/sync',{elements:[{id:'image-element',type:'image',x:0,y:0,width:64,height:64,fileId:'image',status:'saved',scale:[1,1]}]});
 await request(tcp,'/api/snapshots',{name:'Before isolation'});const before=await state(tcp);pass('legacy six-patch TCP editor created scene, image and snapshot');
 pool=new Workers(engine,personal);await assert.rejects(pool.acquire(board));assert.deepEqual(await state(tcp),before);pass('isolation refuses takeover while legacy writer is live');
 await stopPlain();const backup=path.join(base,'backup');backupOffline({dataDir:data,outDir:backup});pass('stopped pre-migration data copied to separate backup');
 lease=await pool.acquire(board);assert.deepEqual(await state({socketPath:lease.socketPath}),before);pass('native isolated editor reads unchanged legacy data');
 assert.throws(()=>backupOffline({dataDir:data,outDir:path.join(base,'unsafe-live-backup')}),/Isolated canvas owner remains/);pass('live isolated offline backup refused regardless of namespace PID');
 lease.release();lease=undefined;await pool.close();
 await startPlain();assert.deepEqual(await state(tcp),before);await stopPlain();pass('rollback to original six-patch TCP engine preserves all data');
 const restored=path.join(base,'restored');backupOffline({dataDir:backup,outDir:restored});
 process.env.BOARDS_LAB_FIXED_DIRECTORIES=JSON.stringify({legacy:path.join(restored,'legacy')});pool=new Workers(engine,path.join(restored,'personal'));lease=await pool.acquire(board);
 assert.deepEqual(await state({socketPath:lease.socketPath}),before);lease.release();lease=undefined;await pool.close();pass('independent backup restore starts with new kernel lease inode');
 console.log(JSON.stringify({tests:results.length,results},null,2));
}finally{lease?.release();await pool?.close();await stopPlain();}
