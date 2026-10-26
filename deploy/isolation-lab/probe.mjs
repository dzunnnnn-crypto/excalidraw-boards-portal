// Synthetic attack probes run inside the exact editor sandbox, never on VPS.
import fs from 'node:fs';
import net from 'node:net';
import {execFileSync} from 'node:child_process';
const input=JSON.parse(Buffer.from(process.argv[2],'base64url').toString());
const results=[];
function check(name,fn){try{fn();results.push({name,passed:true});}catch(e){results.push({name,passed:false,error:e.message});}}
function mustFail(action){let failed=false;try{action();}catch{failed=true;}if(!failed)throw new Error('Unexpected access');}
check('own board writable',()=>{fs.writeFileSync('/board/probe-own.txt','synthetic');if(fs.readFileSync('/board/probe-own.txt','utf8')!=='synthetic')throw new Error('write failed');});
check('auth cannot be read',()=>mustFail(()=>fs.readFileSync(input.auth)));
check('auth cannot be written',()=>mustFail(()=>fs.writeFileSync(input.auth,'attacker')));
check('sibling board cannot be read',()=>mustFail(()=>fs.readFileSync(input.other)));
check('sibling board cannot be written',()=>mustFail(()=>fs.writeFileSync(input.other,'attacker')));
check('host processes hidden',()=>{if(fs.existsSync(`/proc/${input.portalPid}/root`))throw new Error('Host process visible');});
check('host root via proc hidden',()=>mustFail(()=>fs.readFileSync('/proc/1/root'+input.auth)));
check('symlink escape blocked',()=>{try{fs.unlinkSync('/board/escape');}catch{}fs.symlinkSync(input.auth,'/board/escape');mustFail(()=>fs.readFileSync('/board/escape'));});
check('engine is read-only',()=>mustFail(()=>fs.writeFileSync('/app/package.json','attacker')));
check('portal secrets absent from environment',()=>{if(process.env.PORTAL_CONFIG||process.env.LAB_PORTAL_SECRET||process.env.NODE_OPTIONS)throw new Error('Inherited environment');});
check('no capabilities',()=>{const status=fs.readFileSync('/proc/self/status','utf8');if(!/^CapEff:\s+0+$/m.test(status))throw new Error('Effective capabilities present');});
check('no-new-privileges enabled',()=>{if(!/^NoNewPrivs:\s+1$/m.test(fs.readFileSync('/proc/self/status','utf8')))throw new Error('NoNewPrivs missing');});
check('nested user namespace disabled',()=>mustFail(()=>execFileSync('/usr/bin/unshare',['-Ur','true'],{stdio:'pipe'})));
function connects(options){return new Promise(resolve=>{const s=net.connect(options);s.setTimeout(700);s.once('connect',()=>{s.destroy();resolve(true);});s.once('error',()=>resolve(false));s.once('timeout',()=>{s.destroy();resolve(false);});});}
for(const [name,options] of [
  ['host admin port blocked',{host:'127.0.0.1',port:input.adminPort}],
  ['host sibling TCP editor blocked',{host:'127.0.0.1',port:input.editorPort}],
  ['host sibling Unix socket blocked',{path:input.otherSocket}],
  ['external route blocked',{host:'192.0.2.1',port:80}],
])results.push({name,passed:!await connects(options)});
console.log(JSON.stringify(results));if(results.some(r=>!r.passed))process.exitCode=1;
