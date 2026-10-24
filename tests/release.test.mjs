import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';import os from 'node:os';import {pathToFileURL} from 'node:url';import crypto from 'node:crypto';
import {execFileSync} from 'node:child_process';
const root=path.resolve(import.meta.dirname,'..');
test('deployment artifact requires Linux and refuses an unverified archive',async()=>{
 const file=path.join(root,'scripts/release.mjs');assert(fs.existsSync(file),'release builder is required');const {buildRelease,verifyArchive}=await import(pathToFileURL(file));
 if(process.platform!=='linux')assert.throws(()=>buildRelease({root,outDir:path.join(os.tmpdir(),'unused-boards-release')}),/Linux/);
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'boards-release-')),archive=path.join(dir,'artifact.tar.gz');fs.writeFileSync(archive,'archive');const manifest={artifactSha256:crypto.createHash('sha256').update('archive').digest('hex')};
 assert.equal(verifyArchive(archive,manifest),true);fs.appendFileSync(archive,'modified');assert.throws(()=>verifyArchive(archive,manifest),/checksum/i);
});
test('Linux builder rejects a dirty source before any build',{skip:process.platform!=='linux'},async()=>{
 const {buildRelease}=await import('../scripts/release.mjs');const dir=fs.mkdtempSync(path.join(os.tmpdir(),'boards-dirty-'));execFileSync('git',['init',dir],{stdio:'ignore'});fs.writeFileSync(path.join(dir,'unknown.txt'),'unreviewed source');assert.throws(()=>buildRelease({root:dir,outDir:path.join(dir,'out')}),/dirty working tree/);
});

test('runtime executable links remain usable after moving the build',{skip:process.platform!=='linux'},async()=>{
 const {copyRuntimeEngine}=await import('../scripts/release.mjs');
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'boards-runtime-links-')),source=path.join(dir,'source'),target=path.join(dir,'release');
 fs.mkdirSync(path.join(source,'node_modules/.bin'),{recursive:true});fs.mkdirSync(path.join(source,'node_modules/example/bin'),{recursive:true});
 fs.writeFileSync(path.join(source,'node_modules/example/bin/cli.js'),"console.log('portable runtime')");
 fs.symlinkSync('../example/bin/cli.js',path.join(source,'node_modules/.bin/example'));
 copyRuntimeEngine(source,target);fs.renameSync(source,path.join(dir,'old-build-location'));
 const link=path.join(target,'node_modules/.bin/example');assert.equal(fs.readlinkSync(link),'../example/bin/cli.js');
 assert.equal(execFileSync(process.execPath,[link],{encoding:'utf8'}).trim(),'portable runtime');
 const bad=path.join(dir,'bad');fs.mkdirSync(path.join(bad,'node_modules/.bin'),{recursive:true});
 fs.symlinkSync(path.join(dir,'old-build-location/node_modules/example/bin/cli.js'),path.join(bad,'node_modules/.bin/example'));
 assert.throws(()=>copyRuntimeEngine(bad,path.join(dir,'invalid-release')),/Non-portable/);
});
