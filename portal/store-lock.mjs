import fs from 'node:fs';import path from 'node:path';import crypto from 'node:crypto';
export function lockStore(stateFile){
 const file=path.join(path.dirname(stateFile),'.portal.lock'),token=crypto.randomUUID(),mine=path.join(file,`owner-${token}.json`);fs.mkdirSync(path.dirname(file),{recursive:true,mode:0o700});
 for(let i=0;i<8;i++){
  try{fs.mkdirSync(file,{mode:0o700});fs.writeFileSync(mine,JSON.stringify({pid:process.pid,token}),{flag:'wx',mode:0o600});return ()=>{try{if(JSON.parse(fs.readFileSync(mine)).token===token)fs.unlinkSync(mine);fs.rmdirSync(file);}catch{}};}
  catch(e){
   if(e.code!=='EEXIST')throw e;if(!fs.lstatSync(file).isDirectory()||fs.lstatSync(file).isSymbolicLink())throw new Error('Invalid portal lock; inspect offline');
   const names=fs.readdirSync(file);if(names.length!==1||!/^owner-[\w-]+\.json$/.test(names[0]))throw new Error('Portal lock is initializing or invalid; inspect offline');
   const observed=path.join(file,names[0]),owner=JSON.parse(fs.readFileSync(observed));if(!Number.isInteger(owner.pid)||owner.pid<1)throw new Error('Invalid portal lock owner');
   let stale=false;try{process.kill(owner.pid,0);}catch(error){stale=error.code==='ESRCH';}
   if(!stale)throw new Error('An active portal already owns this authentication store');
   // Remove only the unique owner we actually observed, never a new owner's file.
   try{fs.unlinkSync(observed);}catch(error){if(error.code!=='ENOENT')throw error;}
   try{fs.rmdirSync(file);}catch(error){if(!['ENOENT','ENOTEMPTY','EEXIST'].includes(error.code))throw error;}
  }
 }
 throw new Error('Unable to acquire portal store lock');
}
