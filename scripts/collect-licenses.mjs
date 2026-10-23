import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {pathToFileURL} from 'node:url';
const hash=b=>crypto.createHash('sha256').update(b).digest('hex');
const posix=p=>p.split(path.sep).join('/');
const under=(root,p)=>{const r=path.relative(root,p);if(r==='..'||r.startsWith('..'+path.sep)||path.isAbsolute(r))throw new Error('License path escapes root');return posix(r);};
function regular(file){if(!fs.lstatSync(file).isFile()||fs.lstatSync(file).isSymbolicLink())throw new Error('License input must be a regular file');return fs.readFileSync(file);}

// Conservative superset: include ALL installed dependencies before prune.
// Build tools are explicitly marked; this is not an exact bundle-size SBOM.
export function collectLicenses({engine,stage,root}) {
 engine=path.resolve(engine);stage=path.resolve(stage);root=path.resolve(root);
 if(fs.existsSync(path.join(stage,'THIRD_PARTY_INVENTORY.json')))throw new Error('License inventory already exists');
 const lock=JSON.parse(regular(path.join(engine,'package-lock.json')));
 const sources=JSON.parse(regular(path.join(root,'docs/licenses/sources.json')));
 const entries=[];
 const output=path.join(stage,'THIRD_PARTY_LICENSES');fs.mkdirSync(output,{recursive:true});
 function copy(file,dest){const bytes=regular(file);if(!bytes.length)throw new Error('Empty license document');fs.mkdirSync(path.dirname(dest),{recursive:true});fs.writeFileSync(dest,bytes);return {path:under(stage,dest),sha256:hash(bytes)};}
 function snapshot(name){const s=sources.find(s=>s.file===name);if(!s)throw new Error('Missing license provenance: '+name);const f=path.join(root,'docs/licenses',name);if(hash(regular(f))!==s.sha256)throw new Error('License snapshot checksum mismatch');return {file:f,source:s.source};}
 function fallback(m){
  if(m.name==='@excalidraw/excalidraw'&&m.license==='MIT')return {file:path.join(root,'docs/licenses/EXCALIDRAW-MIT.txt'),source:'Excalidraw MIT snapshot'};
  if(m.name.startsWith('@radix-ui/')&&m.license==='MIT')return snapshot('RADIX-MIT.txt');
  if(m.name==='saxes'&&m.version==='6.0.0'&&m.license==='ISC')return snapshot('SAXES-LICENSE.txt');
  if(m.name==='react-remove-scroll-bar'&&m.version==='2.3.8'&&m.license==='MIT')return snapshot('REACT-REMOVE-SCROLL-BAR-MIT.txt');
  const family=m.name.startsWith('@esbuild/')?'esbuild':m.name.startsWith('@rollup/')?'rollup':m.name.startsWith('@resvg/resvg-js-')?'@resvg/resvg-js':null;
  if(family){const dir=path.join(engine,'node_modules',family);const parent=JSON.parse(regular(path.join(dir,'package.json')));if(parent.version!==m.version)throw new Error('Native package/license version mismatch: '+m.name);const file=fs.readdirSync(dir).find(n=>/^license(?:\.|$)/i.test(n));if(file)return {file:path.join(dir,file),source:family+'@'+m.version};}
 }
 function visit(dir){
  for(const e of fs.readdirSync(dir,{withFileTypes:true}).sort((a,b)=>a.name.localeCompare(b.name))){
   if(e.name==='.bin')continue;
   if(e.isSymbolicLink())throw new Error('Symlink in license inventory: '+e.name);
   if(!e.isDirectory())continue;
   const pkg=path.join(dir,e.name);
   if(e.name.startsWith('@')){visit(pkg);continue;}
   const manifest=path.join(pkg,'package.json');if(!fs.existsSync(manifest))continue;
   const m=JSON.parse(regular(manifest)),sourcePath=under(engine,pkg),pinned=lock.packages[sourcePath];
   if(!m.name||!m.version||!pinned||pinned.version!==m.version)throw new Error('Installed package disagrees with lock: '+sourcePath);
   const license=typeof m.license==='string'?m.license:m.license?.type||m.licenses?.map(l=>typeof l==='string'?l:l.type).filter(Boolean).join(' OR ')||pinned.license||'LicenseRef-packaged-text';
   m.license=license;
   const key=m.name.replace(/[^a-zA-Z0-9._-]/g,'_')+'-'+m.version+'-'+hash(sourcePath).slice(0,10);
   const target=path.join(output,key),documents=[];let origin='installed package';
   const docs=fs.readdirSync(pkg).filter(n=>/^(?:licen[sc]e|notice|copying|copyright|unlicense)(?:[.\-_]|$)/i.test(n)&&fs.lstatSync(path.join(pkg,n)).isFile());
   for(const file of docs)documents.push(copy(path.join(pkg,file),path.join(target,file)));
   if(!documents.length){
    const readme=fs.readdirSync(pkg).find(n=>/^readme(?:\.|$)/i.test(n));
    if(readme&&/Permission is hereby granted|Permission to use, copy/.test(regular(path.join(pkg,readme)).toString()))documents.push(copy(path.join(pkg,readme),path.join(target,readme)));
    else {const f=fallback(m);if(!f)throw new Error('No license text for '+m.name+'@'+m.version);origin=f.source;documents.push(copy(f.file,path.join(target,path.basename(f.file))));}
   }
   const metadata=Buffer.from(JSON.stringify({name:m.name,version:m.version,license:m.license,author:m.author,repository:m.repository},null,2)+'\n');
   const mf=path.join(target,'package-metadata.json');fs.mkdirSync(target,{recursive:true});fs.writeFileSync(mf,metadata);
   documents.push({path:under(stage,mf),sha256:hash(metadata)});
   entries.push({name:m.name,version:m.version,license:m.license,scope:pinned.dev?'build-or-bundled':'runtime',sourcePackagePath:sourcePath,noticeSource:origin,documents});
   if(fs.existsSync(path.join(pkg,'node_modules')))visit(path.join(pkg,'node_modules'));
  }
 }
 visit(path.join(engine,'node_modules'));
 const declared=JSON.parse(regular(path.join(engine,'package.json')));
 for(const name of Object.keys({...declared.dependencies,...declared.devDependencies})){
  if(!entries.some(e=>e.sourcePackagePath==='node_modules/'+name))throw new Error('Collect licenses before pruning: missing direct dependency '+name);
 }
 // Font notices cover both actual frontend WOFF2 and headless TTF files.
 const fonts=[];
 function findFonts(dir){for(const e of fs.readdirSync(dir,{withFileTypes:true})){const p=path.join(dir,e.name);if(e.isSymbolicLink())throw new Error('Symlink in font assets');if(e.isDirectory())findFonts(p);else if(/\.(?:woff2?|ttf|otf)$/i.test(e.name))fonts.push(p);}}
 findFonts(path.join(engine,'dist'));findFonts(path.join(engine,'assets'));
 for(const file of fonts){
  const name=path.basename(file),assistant=/^Assistant-.*\.woff2$/.test(name);
  if(!assistant&&!/^(?:Excalifont|Virgil|CascadiaCode|LiberationSans)-Regular\.ttf$/.test(name))throw new Error('Unmapped bundled font: '+name);
  const f=assistant?snapshot('ASSISTANT-OFL.txt'):{file:path.join(engine,'assets/fonts/LICENSES.md'),source:'Pinned upstream assets/fonts/LICENSES.md'};
  const doc=copy(f.file,path.join(output,'fonts',assistant?'ASSISTANT-OFL.txt':'HEADLESS-FONTS-OFL.md'));
  entries.push({name:'font:'+name,version:'sha256:'+hash(regular(file)),license:'OFL-1.1',scope:'font',assetPath:'.vendor/upstream/'+under(engine,file),assetSha256:hash(regular(file)),noticeSource:f.source,documents:[doc]});
 }
 entries.sort((a,b)=>(a.name+a.version+(a.sourcePackagePath||a.assetPath)).localeCompare(b.name+b.version+(b.sourcePackagePath||b.assetPath)));
 fs.writeFileSync(path.join(stage,'THIRD_PARTY_INVENTORY.json'),JSON.stringify(entries,null,2)+'\n');
 fs.writeFileSync(path.join(output,'README.md'),'# Third-party license collection\n\nConservative inventory of all installed packages BEFORE pruning, including build tools and bundled libraries. It is not an exact per-chunk SBOM. Package metadata, original LICENSE/NOTICE documents and local font notices are retained here. Runtime node_modules also keep their original notices.\n');
 return entries;
}

export function verifyLicenses(stage){
 stage=path.resolve(stage);const entries=JSON.parse(regular(path.join(stage,'THIRD_PARTY_INVENTORY.json')));
 if(!Array.isArray(entries)||!entries.length)throw new Error('Missing third-party inventory');
 const seen=new Set();
 for(const e of entries){
  if(!e.documents?.length||!e.license)throw new Error('Incomplete license entry');
  for(const d of e.documents){const f=path.resolve(stage,d.path);under(stage,f);if(hash(regular(f))!==d.sha256)throw new Error('License document checksum mismatch: '+d.path);}
  if(e.assetPath){const f=path.resolve(stage,e.assetPath);under(stage,f);if(hash(regular(f))!==e.assetSha256)throw new Error('Font checksum mismatch');seen.add(e.assetPath);}
 }
 const engine=path.join(stage,'.vendor/upstream');
 const declared=JSON.parse(regular(path.join(engine,'package.json')));
 for(const name of Object.keys({...declared.dependencies,...declared.devDependencies})){
  if(!entries.some(e=>e.sourcePackagePath==='node_modules/'+name))throw new Error('Direct build/runtime dependency missing from license inventory: '+name);
 }
 function checkFonts(dir){if(!fs.existsSync(dir))return;for(const e of fs.readdirSync(dir,{withFileTypes:true})){const p=path.join(dir,e.name);if(e.isSymbolicLink())throw new Error('Symlink in font assets');if(e.isDirectory())checkFonts(p);else if(/\.(?:woff2?|ttf|otf)$/i.test(e.name)&&!seen.has(under(stage,p)))throw new Error('Font missing from license inventory');}}
 function checkPackages(dir){if(!fs.existsSync(dir))return;for(const e of fs.readdirSync(dir,{withFileTypes:true})){if(e.name==='.bin')continue;const p=path.join(dir,e.name);if(e.isSymbolicLink())throw new Error('Symlink in packaged dependencies');if(!e.isDirectory())continue;if(e.name.startsWith('@')){checkPackages(p);continue;}if(!fs.existsSync(path.join(p,'package.json')))continue;const m=JSON.parse(regular(path.join(p,'package.json')));if(!entries.some(x=>x.sourcePackagePath===under(engine,p)&&x.name===m.name&&x.version===m.version))throw new Error('Runtime package missing from license inventory: '+m.name);checkPackages(path.join(p,'node_modules'));}}
 checkFonts(path.join(engine,'dist'));checkFonts(path.join(engine,'assets'));checkPackages(path.join(engine,'node_modules'));
 return entries.length;
}
if(process.argv[1]&&pathToFileURL(path.resolve(process.argv[1])).href===import.meta.url){try{console.log('License inventory verified:',verifyLicenses(process.argv[2]));}catch(e){console.error(e.message);process.exitCode=1;}}
