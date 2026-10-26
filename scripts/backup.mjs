import fs from 'node:fs';import path from 'node:path';import {pathToFileURL} from 'node:url';
function alive(pid){try{process.kill(pid,0);return true;}catch(e){return e.code!=='ESRCH';}}
export function backupOffline({dataDir,outDir}){
 const source=fs.realpathSync(dataDir),target=path.resolve(outDir);
 const within=(a,b)=>a===b||b.startsWith(a+path.sep);
 if(within(source,target)||within(target,source))throw new Error('Backup paths overlap');
 if(fs.existsSync(target))throw new Error('Backup destination already exists');
 // Resolve the nearest existing parent as well, preventing symlink destination aliases.
 let parent=path.dirname(target);while(!fs.existsSync(parent))parent=path.dirname(parent);
 if(within(source,fs.realpathSync(parent)))throw new Error('Backup paths overlap through an alias');
 function inspect(dir){for(const ent of fs.readdirSync(dir,{withFileTypes:true})){
  const file=path.join(dir,ent.name);if(ent.isSymbolicLink())throw new Error('Symlinks are not included in an offline backup');
  if(ent.name==='.portal.lock'){
   if(ent.isDirectory()){for(const name of fs.readdirSync(file)){const owner=JSON.parse(fs.readFileSync(path.join(file,name)));if(alive(owner.pid))throw new Error('Portal is running; stop it before backup');}}
   else {const owner=JSON.parse(fs.readFileSync(file));if(alive(owner.pid))throw new Error('Portal is running; stop it before backup');}
   continue;
  }
  if(ent.name==='canvas-state.lock'){
   for(const name of fs.readdirSync(file)){const owner=JSON.parse(fs.readFileSync(path.join(file,name)));
    // Namespace PIDs cannot be tested for liveness from the host. A remaining
    // isolated owner is always unsafe for an offline copy, even after a crash.
    if(Object.hasOwn(owner,'lease'))throw new Error('Isolated canvas owner remains; stop or recover the editor before backup');
    if(alive(owner.pid))throw new Error('Canvas is active; stop it before backup');}
  }else if(ent.isDirectory())inspect(file);
 }}inspect(source);
 fs.cpSync(source,target,{recursive:true,errorOnExist:true,force:false,filter:p=>!['.portal.lock','canvas-state.lock'].includes(path.basename(p))});
 function protect(dir){fs.chmodSync(dir,0o700);for(const e of fs.readdirSync(dir,{withFileTypes:true})){const p=path.join(dir,e.name);e.isDirectory()?protect(p):fs.chmodSync(p,0o600);}}protect(target);
 return target;
}
if(process.argv[1]&&pathToFileURL(path.resolve(process.argv[1])).href===import.meta.url){try{const arg=n=>process.argv[process.argv.indexOf(n)+1];if(!process.argv.includes('--data-dir')||!process.argv.includes('--out'))throw new Error('Use --data-dir <stopped data directory> --out <new backup directory>');backupOffline({dataDir:arg('--data-dir'),outDir:arg('--out')});console.log('Confidential offline backup created.');}catch(e){console.error(e.message);process.exitCode=1;}}
