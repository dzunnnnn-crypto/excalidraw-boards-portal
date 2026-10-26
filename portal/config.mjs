import fs from 'node:fs';import path from 'node:path';
export function loadConfig({root=path.resolve(import.meta.dirname,'..'),configPath,env=process.env}={}){
 const file=path.resolve(configPath||env.PORTAL_CONFIG||path.join(root,'config.local.json'));
 if(!fs.existsSync(file))throw new Error('Configuration missing. For an isolated local demo run npm run demo:init; for an existing installation supply PORTAL_CONFIG.');
 return resolveConfig(JSON.parse(fs.readFileSync(file,'utf8')),root);
}
export function resolveConfig(c,root){
 const port=Number(c.port??8805),host=c.host||'127.0.0.1';
 if(!Number.isInteger(port)||port<1||port>65535||host!=='127.0.0.1')throw new Error('Portal must listen on loopback with a valid port');
 const u=new URL(c.origin);if(u.username||u.password||u.pathname!=='/'||u.search||u.hash)throw new Error('Expected an origin without path or credentials');
 const localDemo=c.localDemo===true;
 if(localDemo){if(u.protocol!=='http:'||!['127.0.0.1','localhost'].includes(u.hostname)||Number(u.port||80)!==port)throw new Error('Local demo requires an explicit matching loopback HTTP origin');}
 else if(u.protocol!=='https:')throw new Error('Production requires HTTPS');
 const resolve=(value,fallback)=>path.resolve(root,value||fallback);
 let workerIsolation;
 if(c.workerIsolation!==undefined){
  const w=c.workerIsolation;
  if(!w||w.mode!=='bubblewrap'||!w.fixedDirectories||typeof w.fixedDirectories!=='object'||Array.isArray(w.fixedDirectories))throw new Error('Invalid worker isolation configuration');
  const fixedDirectories={};
  for(const [id,directory] of Object.entries(w.fixedDirectories)){
   if(!/^[a-z0-9-]{1,80}$/.test(id)||typeof directory!=='string'||!path.isAbsolute(directory))throw new Error('Invalid isolated fixed board directory');
   fixedDirectories[id]=path.resolve(directory);
  }
  workerIsolation={mode:'bubblewrap',fixedDirectories};
 }
 const dataRoot=resolve(c.dataRoot,'.local');const maxWorkers=Number(c.maxWorkers??2),idleMs=Number(c.idleMs??120000);
 const authStateFile=resolve(c.authStateFile,path.join(dataRoot,'auth.json')),personalDataRoot=resolve(c.personalDataRoot,path.join(dataRoot,'personal'));
 if(workerIsolation){
  const overlaps=(a,b)=>a===b||a.startsWith(b+path.sep)||b.startsWith(a+path.sep);
  const fixed=Object.values(workerIsolation.fixedDirectories);
  for(let n=0;n<fixed.length;n++){
   if(overlaps(fixed[n],authStateFile)||overlaps(fixed[n],personalDataRoot)||fixed.slice(0,n).some(other=>overlaps(fixed[n],other)))throw new Error('Isolated board directories overlap protected or shared data');
  }
 }
 if(!Number.isInteger(maxWorkers)||maxWorkers<1||maxWorkers>16||!Number.isInteger(idleMs)||idleMs<1000)throw new Error('Invalid worker limits');
 return {workerIsolation,appRoot:resolve(c.appRoot,'.vendor/upstream'),dataRoot,authStateFile,boardsConfig:resolve(c.boardsConfig,path.join(dataRoot,'boards.json')),personalDataRoot,origin:u.origin,host,port,localDemo,maxWorkers,idleMs,cookieName:localDemo?'board_session_dev':'__Host-board_session',secureCookies:!localDemo};
}
