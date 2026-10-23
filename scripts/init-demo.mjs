import fs from 'node:fs';import path from 'node:path';import {pathToFileURL} from 'node:url';
import {loadConfig} from '../portal/config.mjs';import {atomicJson,passwordHash,secret} from '../portal/access.mjs';
export function initDemo({root=path.resolve(import.meta.dirname,'..'),configPath,port=8805}={}){
 const file=configPath||path.join(root,'config.local.json');
 let created=false;
 if(!fs.existsSync(file)){atomicJson(file,{localDemo:true,origin:`http://127.0.0.1:${port}`,port,dataRoot:'.local',appRoot:'.vendor/upstream'});created=true;}
 const c=loadConfig({root,configPath:file,env:{}});
 if(!c.localDemo)throw new Error('Demo initializer refuses a production configuration');
 if(fs.existsSync(c.authStateFile))throw new Error('State already exists; demo initialization will not overwrite it');
 if(!created&&fs.existsSync(c.personalDataRoot)&&fs.readdirSync(c.personalDataRoot).length)throw new Error('Existing board data will not be initialized');
 const credentials={alice:secret(),bob:secret()};
 const users=Object.fromEntries(Object.entries(credentials).map(([id,password])=>[id,{id,username:id,name:id==='alice'?'РђР»РёСЃР°':'Р‘РѕСЂРёСЃ',active:true,...passwordHash(password)}]));
 const board={id:'b-demo-project',name:'Р—Р°РїСѓСЃРє РєР»РёРµРЅС‚СЃРєРѕРіРѕ РїРѕСЂС‚Р°Р»Р°',description:'Р’С‹РјС‹С€Р»РµРЅРЅС‹Р№ РїСЂРѕРµРєС‚: Р·Р°РґР°С‡Рё, СЃС…РµРјР°, СЂРµС€РµРЅРёСЏ',owner:'alice',grants:{},sections:[],created:Date.now(),color:'#557566'};
 atomicJson(c.authStateFile,{version:2,users,boards:{[board.id]:board},sessions:{},invitations:{},tokens:{},activations:{}});
 atomicJson(c.boardsConfig,[]);atomicJson(path.join(c.dataRoot,'demo-credentials.json'),credentials);
 const example=path.join(path.resolve(import.meta.dirname,'..'),'examples/project-board.excalidraw');
 if(fs.existsSync(example)){
 const scene=JSON.parse(fs.readFileSync(example));const dir=path.join(c.personalDataRoot,board.id,'canvas');
 atomicJson(path.join(dir,'canvas-state-v1.json'),{schemaVersion:1,elements:scene.elements,files:[],snapshots:[]});
 }
 return c;
}
if(process.argv[1]&&pathToFileURL(path.resolve(process.argv[1])).href===import.meta.url){try{const c=initDemo();console.log(`Demo initialized at ${c.origin}; credentials saved privately in .local/demo-credentials.json.`);}catch(e){console.error(e.message);process.exitCode=1;}}
