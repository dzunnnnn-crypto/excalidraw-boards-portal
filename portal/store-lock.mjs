import fs from 'node:fs';import path from 'node:path';import crypto from 'node:crypto';
export function lockStore(stateFile){
 const file=path.join(path.dirname(stateFile),'.portal.lock'),token=crypto.randomUUID();fs.mkdirSync(path.dirname(file),{recursive:true,mode:0o700});
 for(let i=0;i<3;i++){
  try{fs.writeFileSync(file,JSON.stringify({pid:process.pid,token}),{flag:'wx',mode:0o600});return ()=>{try{if(JSON.parse(fs.readFileSync(file)).token===token)fs.unlinkSync(file);}catch{}};}
  catch(e){if(e.code!=='EEXIST')throw e;const owner=JSON.parse(fs.readFileSync(file));try{process.kill(owner.pid,0);}catch(error){if(error.code==='ESRCH'){fs.unlinkSync(file);continue;}}throw new Error('An active portal already owns this authentication store');}
 }
 throw new Error('Unable to acquire portal store lock');
}
