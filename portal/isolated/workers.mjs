import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import {spawn} from 'node:child_process';
import {randomBytes} from 'node:crypto';
import {sandboxCommand} from './sandbox.mjs';
import {fail} from '../access.mjs';
const delay=ms=>new Promise(r=>setTimeout(r,ms));
function configAt(socketPath){return new Promise((resolve,reject)=>{
  const req=http.get({socketPath,path:'/api/board-config',timeout:1000},res=>{
    let data='';res.on('data',b=>data+=b);res.on('end',()=>{try{resolve(JSON.parse(data));}catch(e){reject(e);}});
  });req.on('timeout',()=>req.destroy(new Error('Timeout')));req.on('error',reject);
});}
export class IsolatedWorkers {
  constructor(appRoot,dataRoot,{maxWorkers=2,idleMs=120000,fixedDirectories={}}={}){
    Object.assign(this,{appRoot,dataRoot,maxWorkers,idleMs});this.running=new Map();this.tail=Promise.resolve();
    this.fixed=fixedDirectories;
    this.leaseRoot=path.join(dataRoot,'.leases');
    this.timer=setInterval(()=>this.reap(),30000);this.timer.unref();
  }
  async get(board){const lease=await this.acquire(board);lease.release();return lease.socketPath;}
  async acquire(board){
    if(this.closing)throw fail(503,'Workers are closing');
    const work=this.tail.then(async()=>{
      if(this.closing)throw fail(503,'Workers are closing');
      const worker=await this.start(board);worker.leases++;
      let released=false;
      return {socketPath:worker.socketPath,release:()=>{if(!released){released=true;worker.leases--;worker.used=Date.now();}}};
    });this.tail=work.catch(()=>{});return work;
  }
  async start(board){
    if(!/^[a-z0-9-]{1,80}$/.test(board.id))throw new Error('Invalid board ID');
    if(board.port&&!Object.hasOwn(this.fixed,board.id))throw fail(503,'Fixed board has no approved isolated data directory');
    let worker=this.running.get(board.id);if(worker?.stopping){await worker.stopping;return this.start(board);}
    if(worker&&(worker.child.signalCode!==null||worker.exited)){await worker.closed;worker=undefined;}
    if(worker){worker.used=Date.now();return worker;}
    if(this.running.size>=this.maxWorkers){
      const idle=[...this.running.values()].filter(w=>!w.leases).sort((a,b)=>a.used-b.used)[0];
      if(!idle)throw fail(503,'All sandbox editors are in use');await this.stop(idle);
    }
    const directory=board.port?this.fixed[board.id]:path.join(this.dataRoot,board.id);
    fs.mkdirSync(directory,{recursive:true,mode:0o700});
    const socketPath=path.join(directory,'editor.sock');if(Buffer.byteLength(socketPath)>100)throw new Error('Lab socket path is too long');
    fs.mkdirSync(this.leaseRoot,{recursive:true,mode:0o700});
    if(fs.realpathSync(this.leaseRoot)!==this.leaseRoot)throw new Error('Lease directory must not be a symlink');
    const leaseFile=path.join(this.leaseRoot,board.id+'.lock');
    try{fs.closeSync(fs.openSync(leaseFile,'wx',0o600));}catch(e){if(e.code!=='EEXIST')throw e;}
    const generation=randomBytes(32).toString('hex');
    const launch=sandboxCommand({engine:this.appRoot,directory,id:board.id,name:board.name,leaseFile,generation});
    launch.options.stdio=['pipe','ignore','pipe'];
    for(let retry=0;retry<10;retry++){
    const child=spawn(launch.file,launch.args,launch.options);
    worker={id:board.id,child,socketPath,directory,leaseFile,leases:0,used:Date.now(),exited:false};this.running.set(board.id,worker);
    let error='';child.stderr.on('data',b=>{error=(error+b).slice(-2000);});child.on('error',e=>{error=e.message;});
    child.stdin.on('error',e=>{if(e.code!=='EPIPE')error=e.message;});
    worker.closed=new Promise(resolve=>child.once('close',()=>{worker.exited=true;if(this.running.get(board.id)===worker)this.running.delete(board.id);resolve();}));
    for(let n=0;n<100;n++){
      if(worker.exited||child.exitCode!==null||child.signalCode!==null)break;
      try{const c=await configAt(socketPath);if(c.id===board.id&&c.generation===generation&&!worker.exited&&child.signalCode===null)return worker;}catch{}
      await delay(100);
    }
    await this.stop(worker);
    if(child.exitCode===73&&retry<9){await delay(100);continue;}
    throw new Error(child.exitCode===73?'Editor kernel lease is busy':'Sandbox failed to start: '+error);
    }
  }
  stop(worker){
    if(worker.stopping)return worker.stopping;
    worker.stopping=(async()=>{
      if(!worker.exited){
        if(worker.child.stdin.writable)worker.child.stdin.end('shutdown\n');
        const timer=setTimeout(()=>worker.child.kill('SIGKILL'),3500);timer.unref();
        try{await worker.closed;}finally{clearTimeout(timer);}
      }
      if(this.running.get(worker.id)===worker)this.running.delete(worker.id);
      // Only the lease-holding backend may reclaim a stale socket or owner.
      // Removing paths here could unlink a successor started by another portal.
    })();return worker.stopping;
  }
  reap(){for(const w of this.running.values())if(!w.leases&&Date.now()-w.used>this.idleMs)void this.stop(w);}
  async close(){this.closing=true;clearInterval(this.timer);await this.tail.catch(()=>{});await Promise.all([...this.running.values()].map(w=>this.stop(w)));}
}
