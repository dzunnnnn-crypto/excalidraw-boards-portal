import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { fail } from './access.mjs';

// Established boards keep their services and data paths. Personal boards start
// only while in use. Never start two writers for the same durable directory.
export class Workers {
  constructor(appRoot,dataRoot){this.appRoot=appRoot;this.dataRoot=dataRoot;this.running=new Map();this.tail=Promise.resolve();this.timer=setInterval(()=>this.reap(),30000);this.timer.unref();}
  async get(board){
    if(board.port)return board.port;
    const work=this.tail.then(()=>this.start(board));this.tail=work.catch(()=>{});return work;
  }
  async acquire(board){
    const work=this.tail.then(async()=>{const port=await this.startOrFixed(board);return {port,release:this.hold(board)};});this.tail=work.catch(()=>{});return work;
  }
  startOrFixed(board){return board.port||this.start(board);}
  async start(board){
    let worker=this.running.get(board.id);
    if(worker?.stopping){await worker.stopping;return this.start(board);}
    if(worker){worker.used=Date.now();return worker.port;}
    if(this.running.size>=2){const idle=[...this.running.values()].filter(w=>!w.leases).sort((a,b)=>a.used-b.used)[0];if(!idle)throw fail(503,'Закройте одну из открытых личных досок и повторите');await this.stop(idle);}
    const reservation=net.createServer();reservation.listen(0,'127.0.0.1');await once(reservation,'listening');const port=reservation.address().port;await new Promise(r=>reservation.close(r));
    const directory=path.join(this.dataRoot,board.id);fs.mkdirSync(directory,{recursive:true,mode:0o700});
    const child=spawn(process.execPath,[path.join(this.appRoot,'dist/server.js')],{cwd:directory,windowsHide:true,stdio:['ignore','ignore','pipe'],env:{...process.env,PORT:String(port),HOST:'127.0.0.1',BOARD_ID:board.id,BOARD_TITLE:board.name,EXCALIDRAW_DATA_DIR:path.join(directory,'canvas'),XDG_STATE_HOME:path.join(this.dataRoot,'runtime'),LOG_FILE_PATH:path.join(directory,'canvas.log'),LOG_LEVEL:'warn'}});
    worker={id:board.id,port,child,used:Date.now(),leases:0};this.running.set(board.id,worker);
    let error='';child.stderr.on('data',b=>{error=(error+b.toString()).slice(-1000);});child.on('error',()=>{});child.on('exit',()=>{if(this.running.get(board.id)===worker)this.running.delete(board.id);});
    for(let n=0;n<60;n++){
      if(child.exitCode!==null)break;
      try{const response=await fetch(`http://127.0.0.1:${port}/api/board-config`,{signal:AbortSignal.timeout(1000)});if((await response.json()).id===board.id)return port;}catch{}
      await new Promise(r=>setTimeout(r,100));
    }
    await this.stop(worker);throw fail(503,'Не удалось открыть доску. Повторите позже');
  }
  hold(board){const w=this.running.get(board.id);if(w)w.leases++;let released=false;return()=>{if(released)return;released=true;if(w){w.leases=Math.max(0,w.leases-1);w.used=Date.now();}};}
  stop(worker){
    if(worker.stopping)return worker.stopping;
    worker.stopping=(async()=>{if(worker.child.exitCode===null){const ended=once(worker.child,'exit');worker.child.kill();await ended;}if(this.running.get(worker.id)===worker)this.running.delete(worker.id);})();
    return worker.stopping;
  }
  reap(){for(const w of this.running.values())if(!w.leases&&Date.now()-w.used>120000)void this.stop(w);}
  async close(){clearInterval(this.timer);await Promise.all([...this.running.values()].map(w=>this.stop(w)));}
}
