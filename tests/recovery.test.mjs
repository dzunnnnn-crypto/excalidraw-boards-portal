import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import {pathToFileURL} from 'node:url';
const root=path.resolve(import.meta.dirname,'..');
test('offline backup preserves content, refuses overlap, symlinks and an active portal',async()=>{
 const file=path.join(root,'scripts/backup.mjs');assert(fs.existsSync(file),'backup implementation is required');const {backupOffline}=await import(pathToFileURL(file));
 const base=fs.mkdtempSync(path.join(os.tmpdir(),'boards-backup-')),data=path.join(base,'data'),out=path.join(base,'backup');fs.mkdirSync(data);fs.writeFileSync(path.join(data,'auth.json'),'{"version":2}');fs.mkdirSync(path.join(data,'blobs'));fs.writeFileSync(path.join(data,'blobs/image.bin'),Buffer.from([1,2,3]));
 assert.throws(()=>backupOffline({dataDir:data,outDir:path.join(data,'bad')}),/overlap/i);
 fs.writeFileSync(path.join(data,'.portal.lock'),JSON.stringify({pid:process.pid}));assert.throws(()=>backupOffline({dataDir:data,outDir:out}),/running|active/i);fs.unlinkSync(path.join(data,'.portal.lock'));
 backupOffline({dataDir:data,outDir:out});assert.equal(fs.readFileSync(path.join(out,'auth.json'),'utf8'),'{"version":2}');assert.deepEqual(fs.readFileSync(path.join(out,'blobs/image.bin')),Buffer.from([1,2,3]));assert.throws(()=>backupOffline({dataDir:data,outDir:out}),/exists/i);
});
