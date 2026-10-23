import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
const engine=process.env.BOARDS_TEST_ENGINE || path.resolve(import.meta.dirname,'../.vendor/upstream');
const {safeMermaidInput}=await import(pathToFileURL(path.join(engine,'frontend/src/utils/mermaidSafety.ts')));

test('Mermaid keeps supported presentation and enforces security limits',()=>{
 const c=safeMermaidInput('flowchart LR; A-->B',{flowchart:{curve:'basis'},themeVariables:{fontSize:'24px'},maxEdges:100});
 assert.equal(c.flowchart.curve,'basis');assert.equal(c.themeVariables.fontSize,'24px');assert.equal(c.maxEdges,100);
 assert.equal(c.securityLevel,'strict');assert(c.secure.includes('securityLevel'));assert(c.secure.includes('themeCSS'));
});
test('Mermaid rejects caller supplied security, CSS and oversized inputs before rendering',()=>{
 for(const c of [{securityLevel:'loose'},{themeCSS:'body{display:none}'},{themeVariables:{fontSize:'20px',fontFamily:'x'}},{maxEdges:501},{maxEdges:-1},{maxTextSize:Infinity},JSON.parse('{"__proto__":{"securityLevel":"loose"}}')]) assert.throws(()=>safeMermaidInput('graph LR; A-->B',c));
 assert.throws(()=>safeMermaidInput('a'.repeat(50001)));
 assert.throws(()=>safeMermaidInput('graph LR; A-->B',{maxTextSize:2}));
});
