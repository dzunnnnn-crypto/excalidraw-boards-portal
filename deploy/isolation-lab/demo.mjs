import fs from 'node:fs';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {initDemo} from '../../scripts/init-demo.mjs';
import {atomicJson,passwordHash} from '../../portal/access.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const data=path.resolve(process.argv[2]),port=Number(process.argv[3]||8806);
fs.mkdirSync(data,{recursive:true,mode:0o700});
const config=path.join(data,'config.json');
if(fs.existsSync(config))throw new Error('Demo already exists; inspect rather than overwrite');
atomicJson(config,{localDemo:true,origin:`http://127.0.0.1:${port}`,port,dataRoot:data,appRoot:path.join(root,'.vendor/upstream'),maxWorkers:5});
const c=initDemo({root,configPath:config,port}),state=JSON.parse(fs.readFileSync(c.authStateFile));
// Public synthetic fixture credentials. Never use these outside this local lab.
Object.assign(state.users.alice,passwordHash('Local-demo-fixture-2026!'));
const fixed={};
for(let n=1;n<=3;n++){
  const id='fixed-'+n;state.boards[id]={id,name:'Isolated fixed board '+n,owner:'alice',grants:{},sections:[],port:3000+n};
  fixed[id]=path.join(data,id);
}
atomicJson(c.authStateFile,state);
const raw=JSON.parse(fs.readFileSync(config));raw.workerIsolation={mode:'bubblewrap',fixedDirectories:fixed};atomicJson(config,raw);
const child=spawn(process.execPath,[path.join(root,'portal/server.mjs')],{
  cwd:root,env:{...process.env,PORTAL_CONFIG:config,BOARDS_LAB_FIXED_DIRECTORIES:JSON.stringify(fixed)},stdio:['ignore','inherit','inherit','ipc']});
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>child.connected&&child.send({type:'portal:shutdown'}));
child.on('exit',code=>process.exit(code||0));
