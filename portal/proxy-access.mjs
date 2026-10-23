import {fail} from './access.mjs';
export async function acquireAuthorizedWorker({workers,access,session,board,write}){
 const lease=await workers.acquire(board);
 try{if(session?.tokenId&&!access.tokenValid(session))throw fail(401,'Ключ отключён');access.require(session,board,write);return lease;}
 catch(error){lease.release();throw error;}
}
