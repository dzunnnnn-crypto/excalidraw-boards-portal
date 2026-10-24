import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {createRequire} from 'node:module';
import {Workers} from '../portal/workers.mjs';

const root=path.resolve(import.meta.dirname,'..');
const engine=process.env.BOARDS_TEST_ENGINE || path.join(root,'.vendor/upstream');
const require=createRequire(path.join(engine,'package.json'));
const {z}=require('zod');
const {boundedArray,MAX_VALIDATION_ITEMS}=await import(pathToFileURL(path.join(engine,'src/core/validation.ts')));

test('oversized schema collections fail before visiting their children',()=>{
 let visits=0;
 const schema=boundedArray(z.string().transform(value=>{visits++;return value;}));
 const result=schema.safeParse(Array(MAX_VALIDATION_ITEMS+1).fill('invalid-size'));
 assert.equal(result.success,false);
 assert.equal(visits,0,'oversized input must not allocate one child result per entry');
 assert.equal(result.error.issues.length,1);
 assert.equal(result.error.issues[0].code,'too_big');
 assert.deepEqual(schema.parse(['valid']),['valid']);
 assert.equal(visits,1);
});

test('HTTP and MCP reject oversized invalid collections without mutating the scene',async()=>{
 fs.mkdirSync(path.join(root,'.local'),{recursive:true});
 const directory=fs.mkdtempSync(path.join(root,'.local/validation-test-'));
 const workers=new Workers(engine,directory);
 const oldUrl=process.env.EXPRESS_SERVER_URL,oldAutostart=process.env.EXCALIDRAW_NO_AUTOSTART;
 try {
  const port=await workers.get({id:'validation',name:'Validation regression'});
  const base=`http://127.0.0.1:${port}`;
  process.env.EXPRESS_SERVER_URL=base;
  process.env.EXCALIDRAW_NO_AUTOSTART='1';
  const {callExcalidrawTool}=await import(pathToFileURL(path.join(engine,'dist/core/mcp-dispatch.js')));
  const request=async(url,body,method='POST')=>{
   const response=await fetch(base+url,{method,headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
   return {status:response.status,data:await response.json()};
  };
  const oversized=Array(MAX_VALIDATION_ITEMS+1).fill({invalid:true});
  const rejected=await request('/api/elements',{id:'rejected',type:'rectangle',x:0,y:0,groupIds:oversized});
  assert.equal(rejected.status,400);
  assert(JSON.stringify(rejected.data).length<2000,'error must not contain one issue per child');
  assert.equal((await (await fetch(base+'/api/elements')).json()).elements.length,0);

  const created=await request('/api/elements',{id:'kept',type:'rectangle',x:10,y:20,groupIds:['one']});
  assert.equal(created.status,200);
  const updated=await request('/api/elements/kept',{x:99,groupIds:oversized},'PUT');
  assert.equal(updated.status,400);
  assert.equal((await (await fetch(base+'/api/elements/kept')).json()).element.x,10);

  const query=await callExcalidrawTool('query_elements',{filter:{id:'kept'}});
  assert(!query.isError,JSON.stringify(query));
  assert(query.content[0].text.includes('kept'),'Zod 4 record filter must remain usable');
  const batch=await callExcalidrawTool('batch_create_elements',{elements:oversized});
  assert.equal(batch.isError,true);
  assert(JSON.stringify(batch).length<2000,'MCP must report one collection error');
  assert.equal((await (await fetch(base+'/api/elements')).json()).elements.length,1);
  const valid=await callExcalidrawTool('batch_create_elements',{elements:[{id:'mcp-valid',type:'rectangle',x:50,y:60}]});
  assert(!valid.isError,JSON.stringify(valid));
  assert.equal((await (await fetch(base+'/api/elements')).json()).elements.length,2);
 } finally {
  await workers.close();
  if(oldUrl===undefined)delete process.env.EXPRESS_SERVER_URL;else process.env.EXPRESS_SERVER_URL=oldUrl;
  if(oldAutostart===undefined)delete process.env.EXCALIDRAW_NO_AUTOSTART;else process.env.EXCALIDRAW_NO_AUTOSTART=oldAutostart;
 }
});
