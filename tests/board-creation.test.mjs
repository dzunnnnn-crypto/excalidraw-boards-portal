import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {Access, atomicJson} from '../portal/access.mjs';

function fixture(t) {
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'shared-board-'));
  t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const file=path.join(dir,'auth.json');
  atomicJson(file,{version:2,users:{dmitry:{id:'dmitry',active:true},alexander:{id:'alexander',active:true},pending:{id:'pending',active:false}},boards:{},tokens:{},invitations:{}});
  return {access:new Access(file),file,session:{user:'dmitry',expires:Date.now()+60000}};
}
test('creation grants edit access to the named participant in one persisted operation',t=>{
  const {access,file,session}=fixture(t);
  const b=access.create(session,{name:'Shared',sharedWith:['dmitry','alexander']});
  const reloaded=new Access(file),alex={user:'alexander',expires:session.expires};
  assert.equal(reloaded.permission(alex,reloaded.board(b.id)),'edit');
  assert.equal(b.owner,'dmitry');assert.deepEqual(b.sharedWith,[{user:'alexander',role:'edit'}]);
  assert.equal(access.create(session,{name:'Private'}).shared,false);
});
test('invalid or inactive participants and malformed keys do not create a private orphan',t=>{
  const {access,session}=fixture(t);
  for(const args of [{sharedWith:['unknown']},{sharedWith:['pending']},{sharedWith:'alexander'},{sharedWith:['__proto__']},{creationKey:'short'}])assert.throws(()=>access.create(session,{name:'Bad',...args}));
  assert.equal(Object.keys(access.state.boards).length,0);
});
test('uncertain creation can be recovered after reload without duplication or changing other boards',t=>{
  const {access,file,session}=fixture(t),args={name:'Shared',description:'Request',sharedWith:['alexander'],creationKey:'12345678-1234-1234-1234-123456789abc'};
  const first=access.create(session,args),reloaded=new Access(file);
  assert.equal(reloaded.create(session,args).id,first.id);
  assert.equal(Object.keys(reloaded.state.boards).length,1);
  assert.throws(()=>reloaded.create(session,{...args,name:'Other'}),/уже использован/);
  delete reloaded.board(first.id).grants.alexander;
  assert.throws(()=>reloaded.create(session,args),/Доступ изменён/);
  assert.equal(reloaded.board(first.id).grants.alexander,undefined);
});
test('failed persistence leaves no in-memory board visible to either participant',t=>{
  const {access,session}=fixture(t);access.save=()=>{throw new Error('Disk full');};
  assert.throws(()=>access.create(session,{name:'No',sharedWith:['alexander']}),/Disk full/);
  assert.equal(Object.keys(access.state.boards).length,0);
});
