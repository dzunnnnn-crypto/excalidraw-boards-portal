import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import {execFileSync} from 'node:child_process';import {pathToFileURL} from 'node:url';import crypto from 'node:crypto';
const root=path.resolve(import.meta.dirname,'..');
test('setup pins source, includes new patch files, repeats safely and rejects local drift',async()=>{
 const script=path.join(root,'scripts/setup-upstream.mjs');assert(fs.existsSync(script),'setup implementation is required');
 const {prepareSource}=await import(pathToFileURL(script));const dir=fs.mkdtempSync(path.join(os.tmpdir(),'boards-setup-'));const repo=path.join(dir,'source');fs.mkdirSync(repo);
 const git=(args,cwd=repo)=>execFileSync('git',args,{cwd,encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
 git(['init']);git(['config','user.name','Test']);git(['config','user.email','test@example.org']);fs.writeFileSync(path.join(repo,'base.txt'),'base\n');git(['add','.']);git(['commit','-m','base']);const commit=git(['rev-parse','HEAD']);
 const patch='diff --git a/new.txt b/new.txt\nnew file mode 100644\nindex 0000000..3e75765\n--- /dev/null\n+++ b/new.txt\n@@ -0,0 +1 @@\n+new\n';const file=path.join(dir,'new.patch');fs.writeFileSync(file,patch);const patches=[{file,sha256:crypto.createHash('sha256').update(patch).digest('hex')}];const target=path.join(dir,'target');
 prepareSource({repository:repo,commit,patches,target});assert.equal(fs.readFileSync(path.join(target,'new.txt'),'utf8'),'new\n');
 prepareSource({repository:repo,commit,patches,target});
 fs.writeFileSync(path.join(target,'new.txt'),'user changes\n');assert.throws(()=>prepareSource({repository:repo,commit,patches,target}),/modified|drift/i);assert.equal(fs.readFileSync(path.join(target,'new.txt'),'utf8'),'user changes\n');
 assert.throws(()=>prepareSource({repository:repo,commit:'0'.repeat(40),patches:[],target:path.join(dir,'bad')}));
});
