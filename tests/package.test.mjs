import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
const root=path.resolve(import.meta.dirname,'..');
test('pinned upstream and attribution are present',()=>{
 assert(fs.existsSync(path.join(root,'upstream.lock.json')),'upstream manifest is required');
 const lock=JSON.parse(fs.readFileSync(path.join(root,'upstream.lock.json')));
 assert.equal(lock.commit,'8084a1c8b410d625fcfd59d5cffb32f3a86a2a6f');
 assert.match(fs.readFileSync(path.join(root,'THIRD_PARTY_NOTICES.md'),'utf8'),/yctimlin\/mcp_excalidraw/);
 assert.match(fs.readFileSync(path.join(root,'LICENSE'),'utf8'),/MIT License/);
});
test('public checker rejects tracked operational state',()=>{
 assert(fs.existsSync(path.join(root,'scripts/check-public.mjs')),'checker is required');
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'boards-package-'));
 spawnSync('git',['init',dir]);fs.mkdirSync(path.join(dir,'.local'));fs.writeFileSync(path.join(dir,'.local/auth.json'),'{}');
 spawnSync('git',['add','-f','.local/auth.json'],{cwd:dir});
 const r=spawnSync(process.execPath,[path.join(root,'scripts/check-public.mjs'),'--root',dir],{encoding:'utf8'});
 assert.notEqual(r.status,0);assert.match(r.stderr,/Forbidden tracked path/);
});
