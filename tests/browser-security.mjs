import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {createRequire} from 'node:module';
import {initDemo} from '../scripts/init-demo.mjs';
const root=path.resolve(import.meta.dirname,'..');
const require=createRequire(path.join(root,'.vendor/upstream/package.json'));
const {chromium}=require('@playwright/test');
const dir=fs.mkdtempSync(path.join(root,'.local/browser-security-'));
const reservation=net.createServer();reservation.listen(0,'127.0.0.1');await once(reservation,'listening');
const port=reservation.address().port;await new Promise(r=>reservation.close(r));
const base=`http://127.0.0.1:${port}`;
const config=path.join(dir,'config.json');
fs.writeFileSync(config,JSON.stringify({localDemo:true,origin:base,port,dataRoot:dir,appRoot:path.join(root,'.vendor/upstream')}));
initDemo({root,configPath:config});
const credentials=JSON.parse(fs.readFileSync(path.join(dir,'demo-credentials.json')));
const child=spawn(process.execPath,[path.join(root,'portal/server.mjs')],{cwd:root,env:{...process.env,PORTAL_CONFIG:config},windowsHide:true,stdio:['ignore','ignore','pipe','ipc']});
let errors='',browser;child.stderr.on('data',b=>errors+=b);
const results=[];
const poll=async(fn,message)=>{for(let n=0;n<160;n++){if(await fn())return;await new Promise(r=>setTimeout(r,100));}throw new Error(message);};
try{
 await poll(async()=>{try{return (await fetch(base+'/health')).ok;}catch{return false;}},'Portal startup failed: '+errors);
 browser=await chromium.launch({headless:true,...(process.env.BROWSER_CHANNEL?{channel:process.env.BROWSER_CHANNEL}:process.platform==='win32'?{channel:'msedge'}:{})});
 const context=await browser.newContext({viewport:{width:1440,height:1000}});
 const page=await context.newPage();const consoleErrors=[];page.on('console',msg=>{if(msg.type()==='error')consoleErrors.push(msg.text());});
 await page.goto(base+'/login');await page.getByLabel('Логин',{exact:true}).fill('alice');await page.getByLabel('Пароль',{exact:true}).fill(credentials.alice);
 await page.getByRole('button',{name:'Войти',exact:true}).click();await page.waitForURL(base+'/');
 await page.getByRole('button',{name:'+ Создать доску',exact:true}).waitFor();results.push('real browser first login');
 await page.screenshot({path:path.join(dir,'desktop-portal.png'),fullPage:true});
 await page.setViewportSize({width:390,height:844});
 assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'Mobile portal horizontal overflow');
 await page.screenshot({path:path.join(dir,'mobile-portal.png'),fullPage:true});results.push('mobile portal 390px, no overflow');
 await page.setViewportSize({width:1440,height:1000});await page.goto(base+'/b/b-demo-project/');
 await page.getByRole('button',{name:'Сохранить',exact:true}).waitFor({state:'visible'});
 await poll(()=>page.getByRole('button',{name:'Сохранить',exact:true}).isEnabled(),'Editor not ready');
 const api=async(url,body,method='POST')=>{
  const response=await context.request.fetch(base+url,{method,headers:{Origin:base},...(body!==undefined?{data:body}:{})});
  assert(response.ok(),`${url}: ${response.status()}`);return response.json();
 };
 const scene=async()=> (await api('/b/b-demo-project/api/elements',undefined,'GET')).elements;
 const token=(await api('/api/tokens',{label:'Disposable browser check'})).token;let sequence=0;
 const mermaid=async(definition,config={})=>{
  const response=await context.request.post(base+'/mcp',{headers:{Origin:base,Authorization:'Bearer '+token},data:{jsonrpc:'2.0',id:++sequence,method:'tools/call',params:{name:'create_from_mermaid',arguments:{board:'b-demo-project',mermaidDiagram:definition,config}}}});
  assert(response.ok());const data=await response.json();assert(!data.error&&!data.result?.isError,JSON.stringify(data));
 };
 for(const [label,definition] of [
  ['Flow result','flowchart LR\n A[Security flow] --> B[Flow result]'],
  ['Sequence result','sequenceDiagram\n Alice->>Bob: Sequence result'],
 ]){
  await mermaid(definition,{flowchart:{curve:'basis'},themeVariables:{fontSize:'24px'}});
  await poll(async()=> (await scene()).some(e=>(e.text||e.originalText||'').includes(label)),`Conversion did not produce ${label}: ${consoleErrors.join('; ')}`);
  results.push('MCP to real browser conversion: '+label);
 }
 const beforeClass=(await scene()).length;
 await mermaid('classDiagram\n class ClassResult {\n +run()\n }');
 await poll(async()=> (await scene()).length>beforeClass,'Class diagram rendering failed');
 const classImage=(await scene()).at(-1);
 if(classImage.type==='image'){
  const files=(await api('/b/b-demo-project/api/files',undefined,'GET')).files;
  assert(Buffer.from(files[classImage.fileId].dataURL.split(',')[1],'base64').toString().includes('ClassResult'),'Class SVG is missing the diagram content');
 }else assert((await scene()).some(e=>(e.text||'').includes('ClassResult')));
 results.push('class diagram content, editable elements or SVG fallback');
 const beforeFallback=(await scene()).length;
 await mermaid('pie title Fallback result\n "First" : 60\n "Second" : 40');
 await poll(async()=> (await scene()).length>beforeFallback&& (await scene()).some(e=>e.type==='image'),'SVG fallback conversion failed');results.push('SVG image fallback');
 const beforeMath=(await scene()).length;
 await mermaid('flowchart LR\n A["$$x^2$$"] --> B["Math result"]');
 await poll(async()=> (await scene()).length>beforeMath,'KaTeX diagram conversion failed');results.push('KaTeX diagram conversion');
 const safeCount=(await scene()).length;
 await api('/b/b-demo-project/api/elements/from-mermaid',{mermaidDiagram:'graph LR; A-->B',config:{securityLevel:'loose',themeCSS:'body{display:none}'}});
 await poll(()=>consoleErrors.some(e=>e.includes('Unsupported Mermaid configuration')),'Unsafe config was not rejected');
 assert.equal((await scene()).length,safeCount);results.push('unsafe config rejected without scene mutation');
 await mermaid('flowchart LR\n A["<img src=x onerror=window.__diagramXss=1>"] --> B["Sanitized result"]');
 await poll(async()=> (await scene()).length>safeCount,'Sanitized input did not complete');
 assert.equal(await page.evaluate(()=>window.__diagramXss),undefined);results.push('HTML handler input does not execute');
 await page.screenshot({path:path.join(dir,'converted-diagrams.png'),fullPage:true});
 const beforeReload=(await scene()).length;await page.reload();await poll(()=>page.getByRole('button',{name:'Сохранить',exact:true}).isEnabled(),'Reload not ready');
 assert.equal((await scene()).length,beforeReload);results.push('converted scene survives reload');
 // PNG export through MCP also exercises the bundled Node exporter and resvg.
 const pngResponse=await context.request.post(base+'/mcp',{headers:{Origin:base,Authorization:'Bearer '+token},data:{jsonrpc:'2.0',id:++sequence,method:'tools/call',params:{name:'get_canvas_screenshot',arguments:{board:'b-demo-project'}}}});
 const png=await pngResponse.json();assert(!png.result?.isError&&png.result?.content?.some(c=>c.type==='image'),JSON.stringify(png));results.push('MCP PNG export of converted scene');
 await context.close();
 fs.writeFileSync(path.join(dir,'result.json'),JSON.stringify({results,screenshots:dir},null,2));
 console.log(JSON.stringify({passed:results.length,results,evidence:path.relative(root,dir)},null,2));
}finally{
 await browser?.close();if(child.exitCode===null){const ended=once(child,'exit');child.send({type:'portal:shutdown'});await ended;}
}

