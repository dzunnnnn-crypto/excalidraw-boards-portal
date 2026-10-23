import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
const root=path.dirname(path.dirname(fileURLToPath(import.meta.url))),require=createRequire(path.join(root,'.vendor/upstream/package.json'));
const {JSDOM}=require('jsdom'),{transformSync}=require('esbuild');
const source=fs.readFileSync(path.join(root,'.vendor/upstream/frontend/src/utils/navigation.ts'),'utf8');
const js=transformSync(source,{loader:'ts',format:'esm',target:'es2022'}).code;
const {attachCanvasNavigation,zoomAtPointer}=await import('data:text/javascript;base64,'+Buffer.from(js).toString('base64'));
const close=(a,b)=>assert(Math.abs(a-b)<1e-7,`${a} != ${b}`);
const initial={scrollX:-321,scrollY:78,offsetLeft:70,offsetTop:96,zoom:{value:.75},editingTextElement:null,viewModeEnabled:false,selectedElementIds:{shape:true}};
for(const [x,y,delta]of [[550,420,120],[100,110,-120],[-20,30,16]]){
 const next=zoomAtPointer(initial,x,y,delta);
 close((x-initial.offsetLeft)/initial.zoom.value-initial.scrollX,(x-initial.offsetLeft)/next.zoom.value-next.scrollX);
 close((y-initial.offsetTop)/initial.zoom.value-initial.scrollY,(y-initial.offsetTop)/next.zoom.value-next.scrollY);
}
assert.equal(zoomAtPointer({...initial,zoom:{value:29}},0,0,-500).zoom.value,30);
assert.equal(zoomAtPointer({...initial,zoom:{value:.11}},0,0,500).zoom.value,.1);
const dom=new JSDOM('<div id="host"><canvas class="excalidraw__canvas interactive"></canvas><canvas id="static"></canvas><input><div id="menu">Menu</div></div>');
const win=dom.window,host=win.document.querySelector('#host'),canvas=host.querySelector('canvas');
const captured=new Set();canvas.setPointerCapture=id=>captured.add(id);canvas.hasPointerCapture=id=>captured.has(id);canvas.releasePointerCapture=id=>captured.delete(id);
let state=structuredClone(initial),updates=[],nativeDowns=0,menus=0;
const elements=[{id:'shape',x:40,y:80,width:200,height:100,version:1}],untouched=JSON.stringify(elements);
const api={getAppState:()=>state,updateScene:change=>{assert.deepEqual(Object.keys(change).sort(),['appState','captureUpdate']);assert.equal(change.captureUpdate,'NEVER');assert.deepEqual(Object.keys(change.appState).filter(k=>!['zoom','scrollX','scrollY'].includes(k)),[]);updates.push(change);state={...state,...change.appState};}};
const detach=attachCanvasNavigation(host,api);
canvas.addEventListener('pointerdown',()=>nativeDowns++);canvas.addEventListener('contextmenu',e=>{menus++;e.preventDefault();});
const wheel=(target=canvas,options={})=>{const e=new win.WheelEvent('wheel',{bubbles:true,cancelable:true,deltaY:120,clientX:300,clientY:200,...options});target.dispatchEvent(e);return e;};
const pointer=(type,target=canvas,options={})=>{const e=new win.MouseEvent(type,{bubbles:true,cancelable:true,button:2,buttons:type==='pointerup'?0:2,clientX:200,clientY:200,...options});Object.defineProperties(e,{pointerId:{value:options.pointerId??1},pointerType:{value:options.pointerType??'mouse'}});target.dispatchEvent(e);return e;};
let old=state.zoom.value;assert(wheel().defaultPrevented);assert(state.zoom.value<old);
old=state.zoom.value;assert(wheel(canvas,{deltaY:-120}).defaultPrevented);assert(state.zoom.value>old);
let count=updates.length;
for(const target of [host.querySelector('input'),host.querySelector('#menu'),host.querySelector('#static')])assert(!wheel(target).defaultPrevented);
assert(!wheel(canvas,{ctrlKey:true}).defaultPrevented);assert(!wheel(canvas,{metaKey:true}).defaultPrevented);assert(!wheel(canvas,{shiftKey:true}).defaultPrevented);
state.editingTextElement={id:'typing'};assert(!wheel().defaultPrevented);state.editingTextElement=null;assert.equal(updates.length,count);
state={...structuredClone(initial),zoom:{value:.5}};
canvas.style.cursor='crosshair';assert(pointer('pointerdown').defaultPrevented);assert.equal(nativeDowns,0);
pointer('pointermove',win,{clientX:240,clientY:220});close(state.scrollX,initial.scrollX+80);close(state.scrollY,initial.scrollY+40);assert.equal(canvas.style.cursor,'grabbing');
count=updates.length;wheel();assert.equal(updates.length,count,'Wheel changed zoom during a pan');
assert(pointer('pointerup',win,{clientX:240,clientY:220}).defaultPrevented);assert.equal(canvas.style.cursor,'crosshair');assert.equal(captured.size,0);assert.equal(menus,0);
const nativeContext=new win.MouseEvent('contextmenu',{bubbles:true,cancelable:true,button:2});canvas.dispatchEvent(nativeContext);assert(nativeContext.defaultPrevented);assert.equal(menus,0,'Drag opened a context menu');
// Both down-triggered and up-triggered native contextmenu orders yield one menu.
for(const early of [true,false]){
 pointer('pointerdown');if(early)canvas.dispatchEvent(new win.MouseEvent('contextmenu',{bubbles:true,cancelable:true,button:2}));
 const before=menus;pointer('pointermove',win,{clientX:201,clientY:201});pointer('pointerup',win,{clientX:201,clientY:201});
 canvas.dispatchEvent(new win.MouseEvent('contextmenu',{bubbles:true,cancelable:true,button:2}));assert.equal(menus,before+1);
}
for(const options of [{button:0,buttons:1},{button:1,buttons:4},{pointerType:'touch'},{pointerType:'pen'},{buttons:3}])assert(!pointer('pointerdown',canvas,options).defaultPrevented);
for(const stop of ['pointercancel','blur','Escape','lostpointercapture','missing-button']){
 pointer('pointerdown');pointer('pointermove',win,{clientX:230,clientY:210});const before=updates.length;
 if(stop==='blur')win.dispatchEvent(new win.Event('blur'));
 else if(stop==='Escape')win.dispatchEvent(new win.KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true}));
 else if(stop==='lostpointercapture')pointer(stop);
 else if(stop==='missing-button')pointer('pointermove',win,{buttons:0});
 else pointer(stop,win);
 pointer('pointermove',win,{clientX:280,clientY:240});assert.equal(updates.length,before);assert.equal(canvas.style.cursor,'crosshair');
}
state.viewModeEnabled=true;pointer('pointerdown');const before=state.scrollX;pointer('pointermove',win,{clientX:240});assert(state.scrollX>before);pointer('pointerup',win);
assert.equal(JSON.stringify(elements),untouched);assert.deepEqual(state.selectedElementIds,{shape:true});
pointer('pointerdown');pointer('pointermove',win,{clientX:240});detach();assert.equal(canvas.style.cursor,'crosshair');assert.equal(captured.size,0);assert(!wheel().defaultPrevented);
dom.window.close();
console.log('PASS: cursor anchor, zoom bounds, wheel/menu/text/pinch isolation, right drag over selected objects, exactly one click menu, cancellation/blur/release, read-only navigation, listener cleanup; scene untouched');
