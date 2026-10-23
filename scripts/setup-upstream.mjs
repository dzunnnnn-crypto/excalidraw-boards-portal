import fs from 'node:fs';import path from 'node:path';import crypto from 'node:crypto';import {execFileSync} from 'node:child_process';import {pathToFileURL} from 'node:url';
const sha=data=>crypto.createHash('sha256').update(data).digest('hex');
function git(target,args){return execFileSync('git',['-C',target,...args],{encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();}
export function prepareSource({repository,commit,patches,target}){
 if(!/^[a-f0-9]{40}$/.test(commit))throw new Error('Expected a full upstream commit');
 for(const p of patches)if(sha(fs.readFileSync(p.file))!==p.sha256)throw new Error('Patch checksum mismatch');
 const identity=sha(JSON.stringify({repository,commit,patches:patches.map(p=>p.sha256)}));
 const stamp=path.join(target,'.git/portal-setup.json');
 if(!fs.existsSync(target)){fs.mkdirSync(path.dirname(target),{recursive:true});execFileSync('git',['clone','--config','core.autocrlf=false','--no-hardlinks',repository,target],{stdio:['ignore','pipe','pipe']});git(target,['checkout','--detach',commit]);}
 if(git(target,['rev-parse','HEAD'])!==commit)throw new Error('Upstream commit mismatch');
 if(fs.existsSync(stamp)){
  const state=JSON.parse(fs.readFileSync(stamp));
  if(state.identity!==identity||state.tree!==git(target,['write-tree'])||git(target,['diff','--name-only'])||git(target,['ls-files','--others','--exclude-standard']))throw new Error('Upstream modified or setup drift; preserve changes and inspect');
  return target;
 }
 if(git(target,['status','--porcelain']))throw new Error('Existing source modified; setup will not overwrite it');
 for(const p of patches)git(target,['apply','--index','--whitespace=nowarn',path.resolve(p.file)]);
 fs.writeFileSync(stamp,JSON.stringify({identity,tree:git(target,['write-tree'])}));return target;
}
export function npmRun(args,cwd){
 const npmCli=process.env.npm_execpath||path.join(path.dirname(process.execPath),'node_modules/npm/bin/npm-cli.js');
 if(fs.existsSync(npmCli))return execFileSync(process.execPath,[npmCli,...args],{cwd,stdio:'inherit'});
 return execFileSync('npm',args,{cwd,stdio:'inherit'});
}
if(process.argv[1]&&pathToFileURL(path.resolve(process.argv[1])).href===import.meta.url){
 try{
 const root=path.resolve(import.meta.dirname,'..'),lock=JSON.parse(fs.readFileSync(path.join(root,'upstream.lock.json')));
 const target=prepareSource({...lock,patches:lock.patches.map(p=>({...p,file:path.join(root,p.file)})),target:path.join(root,'.vendor/upstream')});
 npmRun(['ci'],target);npmRun(['run','build'],target);console.log('Pinned engine and portal patches built successfully.');
 }catch(error){console.error(error.message);process.exitCode=1;}
}
