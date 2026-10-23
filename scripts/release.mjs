import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import crypto from 'node:crypto';import {execFileSync} from 'node:child_process';import {pathToFileURL} from 'node:url';import {prepareSource,npmRun} from './setup-upstream.mjs';
import {auditDependencies} from './check-dependencies.mjs';
const sha=file=>crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
export function verifyArchive(archive,manifest){if(sha(archive)!==manifest.artifactSha256)throw new Error('Artifact checksum mismatch');return true;}
export function buildRelease({root=path.resolve(import.meta.dirname,'..'),outDir}={}){
 if(process.platform!=='linux'||!process.report.getReport().header.glibcVersionRuntime)throw new Error('Deployment artifact requires Linux with glibc; never copy Windows node_modules to VPS');
 const git=args=>execFileSync('git',args,{cwd:root,encoding:'utf8'}).trim();
 if(git(['status','--porcelain']))throw new Error('Commit reviewed changes before building a release (dirty working tree)');
 const lock=JSON.parse(fs.readFileSync(path.join(root,'upstream.lock.json'))),engine=path.join(root,'.vendor/upstream');
 prepareSource({...lock,patches:lock.patches.map(p=>({...p,file:path.join(root,p.file)})),target:engine});
 if(!fs.existsSync(path.join(engine,'dist/server.js')))throw new Error('Run npm run setup first');
 execFileSync(process.execPath,[path.join(root,'scripts/check-public.mjs')],{cwd:root,stdio:'inherit'});
 const commit=git(['rev-parse','HEAD']),stage=fs.mkdtempSync(path.join(os.tmpdir(),'boards-runtime-'));
 const files=execFileSync('git',['ls-files','-z'],{cwd:root,encoding:'utf8'}).split('\0').filter(Boolean);
 for(const name of files){const dest=path.join(stage,name);fs.mkdirSync(path.dirname(dest),{recursive:true});fs.copyFileSync(path.join(root,name),dest);}
 // Never trust ignored build output left in the developer checkout.
 const freshEngine=path.join(fs.mkdtempSync(path.join(os.tmpdir(),'boards-engine-build-')),'upstream');
 prepareSource({...lock,patches:lock.patches.map(p=>({...p,file:path.join(root,p.file)})),target:freshEngine});
 npmRun(['ci'],freshEngine);auditDependencies(freshEngine);npmRun(['run','build'],freshEngine);npmRun(['prune','--omit=dev'],freshEngine);
 const runtimeEngine=path.join(stage,'.vendor/upstream');fs.mkdirSync(runtimeEngine,{recursive:true});
 for(const name of ['dist','assets','node_modules','package.json','package-lock.json','LICENSE']){const source=path.join(freshEngine,name);if(fs.existsSync(source))fs.cpSync(source,path.join(runtimeEngine,name),{recursive:true});}
 const licenses=[];
 function inventory(dir){for(const e of fs.readdirSync(dir,{withFileTypes:true})){if(e.name==='.bin'||e.isSymbolicLink())continue;const p=path.join(dir,e.name);if(e.isDirectory()){const meta=path.join(p,'package.json');if(fs.existsSync(meta)){const v=JSON.parse(fs.readFileSync(meta));licenses.push({name:v.name,version:v.version,license:v.license||'See package license files'});const nested=path.join(p,'node_modules');if(fs.existsSync(nested))inventory(nested);}else if(e.name.startsWith('@'))inventory(p);}}}
 inventory(path.join(runtimeEngine,'node_modules'));fs.writeFileSync(path.join(stage,'THIRD_PARTY_INVENTORY.json'),JSON.stringify(licenses,null,2)+'\n');
 const meta={sourceCommit:commit,upstreamCommit:lock.commit,patches:lock.patches,nodeMajor:24,platform:process.platform,arch:process.arch,libc:'glibc',stateSchema:2};
 fs.writeFileSync(path.join(stage,'release.json'),JSON.stringify(meta,null,2)+'\n');
 const output=path.resolve(outDir||path.join(root,'release',commit.slice(0,12)));fs.mkdirSync(output,{recursive:true});
 const archive=path.join(output,`boards-portal-${commit.slice(0,12)}-linux-${process.arch}.tar.gz`);if(fs.existsSync(archive))throw new Error('Release archive already exists');
 execFileSync('tar',['-czf',archive,'-C',stage,'.']);const manifest={...meta,artifact:path.basename(archive),artifactSha256:sha(archive)};
 fs.writeFileSync(path.join(output,'manifest.json'),JSON.stringify(manifest,null,2)+'\n');
 return {archive,manifest,stage};
}
if(process.argv[1]&&pathToFileURL(path.resolve(process.argv[1])).href===import.meta.url){try{const i=process.argv.indexOf('--out');const result=buildRelease({outDir:i>=0?process.argv[i+1]:undefined});console.log(JSON.stringify({archive:result.archive,manifest:result.manifest},null,2));}catch(e){console.error(e.message);process.exitCode=1;}}
