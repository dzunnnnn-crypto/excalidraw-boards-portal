import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {backupOffline} from '../scripts/backup.mjs';

test('offline backup rejects isolated owners without interpreting namespace PID on host',()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'isolated-backup-'));
  const source=path.join(root,'source'),target=path.join(root,'backup');
  const lock=path.join(source,'personal','board','canvas','canvas-state.lock');fs.mkdirSync(lock,{recursive:true});
  const owner=JSON.stringify({pid:999999999,token:'synthetic',lease:'0:123'});
  fs.writeFileSync(path.join(lock,'owner.json'),owner);
  assert.throws(()=>backupOffline({dataDir:source,outDir:target}),/Isolated canvas owner remains/);
  assert(!fs.existsSync(target));assert.equal(fs.readFileSync(path.join(lock,'owner.json'),'utf8'),owner);
});

test('offline backup remains usable after an isolated editor has stopped cleanly',()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'isolated-backup-stopped-'));
  const source=path.join(root,'source'),target=path.join(root,'backup');fs.mkdirSync(source);
  fs.writeFileSync(path.join(source,'state.json'),'synthetic-checkpoint');
  backupOffline({dataDir:source,outDir:target});
  assert.equal(fs.readFileSync(path.join(target,'state.json'),'utf8'),'synthetic-checkpoint');
});
