import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {fileURLToPath} from 'node:url';
import {sandboxCommand} from './sandbox.mjs';
const here=path.dirname(fileURLToPath(import.meta.url)),root=path.resolve(here,'../..');
const data=path.resolve(process.argv[2]);fs.mkdirSync(data,{recursive:true});
const auth=path.join(data,'auth.json'),other=path.join(data,'b','marker.txt'),directory=path.join(data,'a');
fs.mkdirSync(path.dirname(other),{recursive:true});fs.mkdirSync(directory,{recursive:true});
fs.writeFileSync(auth,'synthetic-auth');fs.writeFileSync(other,'synthetic-other');
const listeners=[];
async function server(address){const s=net.createServer(c=>c.end());s.listen(address);await once(s,'listening');listeners.push(s);return s.address();}
const admin=await server({host:'127.0.0.1',port:0}),editor=await server({host:'127.0.0.1',port:0});
const otherSocket=path.join(data,'b','editor.sock');await server(otherSocket);
const input={auth,other,otherSocket,portalPid:process.pid,adminPort:admin.port,editorPort:editor.port};
const spec=sandboxCommand({engine:fs.realpathSync(path.join(root,'.vendor/upstream')),directory,id:'a',name:'Synthetic A',
  extraMounts:[[path.join(here,'probe.mjs'),'/sandbox/probe.mjs']],command:['/runtime/node','/sandbox/probe.mjs',Buffer.from(JSON.stringify(input)).toString('base64url')]});
spec.options.stdio=['ignore','pipe','pipe'];spec.options.env={...spec.options.env,LAB_PORTAL_SECRET:'must-not-leak',NODE_OPTIONS:''};
try{
  const child=spawn(spec.file,spec.args,spec.options);let output='',error='';child.stdout.on('data',b=>output+=b);child.stderr.on('data',b=>error+=b);
  const [code]=await once(child,'exit');assert.equal(code,0,error||output);
  const results=JSON.parse(output);assert(results.every(r=>r.passed));
  assert.equal(fs.readFileSync(auth,'utf8'),'synthetic-auth');assert.equal(fs.readFileSync(other,'utf8'),'synthetic-other');
  // Positive control: the tested host ports really are listening outside sandbox.
  for(const port of [admin.port,editor.port]){const c=net.connect(port,'127.0.0.1');await once(c,'connect');c.destroy();}
  const c=net.connect(otherSocket);await once(c,'connect');c.destroy();
  console.log(JSON.stringify({tests:results.length,results,positiveControls:3,hostMarkersUnchanged:true},null,2));
}finally{await Promise.all(listeners.map(s=>new Promise(r=>s.close(r))));}
