import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
let text=fs.readFileSync(path.join(root,'tests/members.test.mjs'),'utf8');
for(const [old,value] of [
  ["appRoot:path.join(root,'.vendor/upstream')","appRoot:path.join(root,'.vendor/upstream'),workerIsolation:{mode:'bubblewrap',fixedDirectories:{}}"],
  ["fs.mkdirSync(path.join(root,'.local'),{recursive:true});","const labState=process.env.BOARDS_LAB_STATE;fs.mkdirSync(labState,{recursive:true});"],
  ["path.join(root,'.local/members-test-')","path.join(labState,'members-test-')"],
  ["path.join(root,'.local','restored-'","path.join(labState,'restored-'"],
  ["restored-'+crypto.randomUUID()","restored-'+crypto.randomUUID().slice(0,8)"],
]){if(!text.includes(old))throw new Error('Functional source changed');text=text.split(old).join(value);}
const needle="  await stop();await start();";
if(text.split(needle).length!==2)throw new Error('Functional source changed');
text=text.replace(needle,`  const exported=await tool(dt.token,'export_scene',{board:db.id});assert(!exported.isError,JSON.stringify(exported));
  const exportText=exported.content.find(c=>c.type==='text').text;
  assert.equal(JSON.parse(exportText).elements.length,3);
  const imported=await tool(dt.token,'import_scene',{board:db.id,data:exportText,mode:'replace'});assert(!imported.isError,JSON.stringify(imported));
  assert.equal((await call(\`/b/\${db.id}/api/files\`,{cookie:d})).data.files['fixture-image'].dataURL,png);
  console.log('PASS: Excalidraw JSON export/import with embedded image');
  const killed=once(child,'exit');child.kill('SIGKILL');await killed;await start();
  assert.equal((await call(\`/b/\${db.id}/api/elements\`,{cookie:d})).data.elements.length,3);
  assert.equal((await call(\`/b/\${db.id}/api/files\`,{cookie:d})).data.files['fixture-image'].dataURL,png);
  assert(!(await tool(dt.token,'get_canvas_screenshot',{board:db.id})).isError);
  console.log('PASS: portal SIGKILL recovery preserves scene, image, session and MCP PNG');
`+needle);
const guestNeedle='  guestSocket=new WebSocket';
if(text.split(guestNeedle).length!==2)throw new Error('Functional guest source changed');
text=text.replace(guestNeedle,`  assert.equal((await call(\`/b/\${db.id}/api/elements\`,{cookie:guest})).status,200);
  assert.equal((await call(\`/b/\${db.id}/api/files\`,{cookie:guest})).status,200);
  assert.equal((await call(\`/b/\${db.id}/api/elements\`,{cookie:guest,method:'POST',body:{type:'rectangle',x:0,y:0}})).status,403);
  assert.equal((await call(\`/b/\${ab.id}/api/elements\`,{cookie:guest})).status,403);
  console.log('PASS: guest reads allowed scene/images, cannot write or read another board');
`+guestNeedle);
fs.mkdirSync(path.join(root,'.local'),{recursive:true});
fs.writeFileSync(path.join(root,'.local/isolation-members.test.mjs'),text);
console.log('Functional suite prepared without changing the original test.');
