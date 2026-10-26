// Controlled migration recovery after the portal has been stopped. No auth
// changes, lock deletion or arbitrary commands are accepted from this input.
import fs from 'node:fs';
import {IsolatedWorkers} from '../../portal/isolated/workers.mjs';
const input=JSON.parse(fs.readFileSync(0,'utf8'));
const workers=new IsolatedWorkers(input.appRoot,input.personalDataRoot,{maxWorkers:1,fixedDirectories:input.fixedDirectories});
try{for(const board of input.boards){const lease=await workers.acquire(board);lease.release();await workers.stop(workers.running.get(board.id));}console.log('Kernel lease owners recovered and cleanly released:',input.boards.length);}
finally{await workers.close();}
