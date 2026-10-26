import test from 'node:test';import assert from 'node:assert/strict';import path from 'node:path';
import {resolveConfig} from '../portal/config.mjs';
const root=path.resolve('synthetic-config-root');
const base={origin:'https://boards.example',dataRoot:path.join(root,'state')};
test('existing config keeps isolation disabled',()=>assert.equal(resolveConfig(base,root).workerIsolation,undefined));
test('isolation mode must be explicit and known',()=>assert.throws(()=>resolveConfig({...base,workerIsolation:{mode:'unknown',fixedDirectories:{}}},root),/Invalid worker isolation/));
test('isolated fixed directory cannot expose auth or the personal-board tree',()=>{
 for(const directory of [base.dataRoot,path.join(base.dataRoot,'personal')])assert.throws(()=>resolveConfig({...base,workerIsolation:{mode:'bubblewrap',fixedDirectories:{main:directory}}},root),/overlap protected/);
});
test('isolated fixed directories cannot overlap each other',()=>assert.throws(()=>resolveConfig({...base,workerIsolation:{mode:'bubblewrap',fixedDirectories:{one:path.join(root,'fixed'),two:path.join(root,'fixed/child')}}},root),/overlap protected/));
test('separate fixed directories are accepted',()=>{
 const fixedDirectories={one:path.join(root,'fixed-one'),two:path.join(root,'fixed-two')};
 assert.deepEqual(resolveConfig({...base,workerIsolation:{mode:'bubblewrap',fixedDirectories}},root).workerIsolation,{mode:'bubblewrap',fixedDirectories});
});
