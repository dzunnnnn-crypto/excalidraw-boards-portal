import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';import os from 'node:os';import {pathToFileURL} from 'node:url';import crypto from 'node:crypto';
const root=path.resolve(import.meta.dirname,'..');
test('deployment artifact requires Linux and refuses an unverified archive',async()=>{
 const file=path.join(root,'scripts/release.mjs');assert(fs.existsSync(file),'release builder is required');const {buildRelease,verifyArchive}=await import(pathToFileURL(file));
 if(process.platform!=='linux')assert.throws(()=>buildRelease({root,outDir:path.join(os.tmpdir(),'unused-boards-release')}),/Linux/);
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'boards-release-')),archive=path.join(dir,'artifact.tar.gz');fs.writeFileSync(archive,'archive');const manifest={artifactSha256:crypto.createHash('sha256').update('archive').digest('hex')};
 assert.equal(verifyArchive(archive,manifest),true);fs.appendFileSync(archive,'modified');assert.throws(()=>verifyArchive(archive,manifest),/checksum/i);
});
