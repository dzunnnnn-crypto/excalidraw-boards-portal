import {lockStore} from './store-lock.mjs';
import {acquireAuthorizedWorker} from './proxy-access.mjs';
import {loadConfig} from './config.mjs';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { Access,atomicJson,passwordHash,digest,secret,fail } from './access.mjs';
import { Workers } from './workers.mjs';
import { RemoteMcp } from './mcp.mjs';

const here=path.dirname(fileURLToPath(import.meta.url));
const config=loadConfig();
const {appRoot,authStateFile:stateFile,origin,port,cookieName,secureCookies}=config;
const require=createRequire(path.join(appRoot,'package.json'));
const express=require('express');const {WebSocket,WebSocketServer}=require('ws');
const day=86400000;
const releaseStore=lockStore(stateFile);process.on('exit',releaseStore);
const initial=JSON.parse(fs.readFileSync(config.boardsConfig,'utf8'));
const access=new Access(stateFile,initial),state=access.state;
const workers=new Workers(appRoot,config.personalDataRoot,{maxWorkers:config.maxWorkers,idleMs:config.idleMs});
const mcp=new RemoteMcp({appRoot,access,workers,port});mcp.origin=origin;
const sockets=new Set(),attempts=new Map();
const app=express();app.disable('x-powered-by');
let stopping=false;
function sessionOf(req){
  const raw=String(req.headers.cookie||'').split(';').map(x=>x.trim()).find(x=>x.startsWith(cookieName+'='))?.slice(cookieName.length+1);
  if(!raw||!/^[-\w]{43}$/.test(raw))return null;
  const session=state.sessions[digest(raw)];return access.valid(session)?session:null;
}
function addSession(res,session,remember=true){
  const raw=secret();for(const [id,old]of Object.entries(state.sessions))if(!access.valid(old))delete state.sessions[id];
  state.sessions[digest(raw)]=session;access.save();
  res.setHeader('Set-Cookie',`${cookieName}=${raw}; Path=/; HttpOnly${secureCookies?'; Secure':''}; SameSite=Lax${remember?`; Max-Age=${Math.max(0,Math.floor((session.expires-Date.now())/1000))}`:''}`);
}
const asyncRoute=fn=>(req,res,next)=>Promise.resolve(fn(req,res,next)).catch(next);
function member(req,res,next){if(!req.session?.user)throw fail(req.session?403:401,'Нужен вход в личную учётную запись');next();}
function owner(req,board){if(access.permission(req.session,board)!=='owner')throw fail(403,'Доступом управляет владелец доски');}
function changed(board){for(const c of sockets)if(c.board.id===board.id&&access.permission(c.session,board)!==c.role)c.client.close(1008,'Access changed');}
app.use((req,res,next)=>{
  if(stopping)throw fail(503,'Сервис завершает работу');
  res.set({'X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer','X-Frame-Options':'SAMEORIGIN','Cache-Control':'no-store'});
  req.session=sessionOf(req);
  const internal=req.path.startsWith('/internal/');
  if(req.path==='/mcp'){if(req.headers.origin&&req.headers.origin!==origin)throw fail(403,'Недопустимый источник запроса');}
  else if(!internal&&!['GET','HEAD','OPTIONS'].includes(req.method)&&req.headers.origin!==origin)throw fail(403,'Недопустимый источник запроса');
  next();
});
const body=express.json({limit:'32kb'});
app.get('/health',(req,res)=>res.json({status:'healthy',service:'private-boards-portal',version:2}));
app.all('/mcp',express.json({limit:'10mb'}),asyncRoute((req,res)=>mcp.handle(req,res)));
app.get('/api/me',(req,res)=>res.json(req.session?{authenticated:true,user:req.session.user?{id:req.session.user,name:access.user(req.session.user).name}:null,role:req.session.user?'member':'view',board:req.session.board}:{authenticated:false}));
app.post('/api/login',body,(req,res)=>{
  const ip=String(req.headers['x-forwarded-for']||req.socket.remoteAddress).split(',').at(-1).trim();
  let attempt=attempts.get(ip);if(!attempt||attempt.until<=Date.now())attempt={count:0,until:Date.now()+15*60000};
  if(attempt.count>=10)throw fail(429,'Слишком много попыток. Повторите через 15 минут');
  const {username,password,remember=true}=req.body||{};
  if(typeof username!=='string'||typeof password!=='string'||password.length>512)throw fail(400,'Проверьте логин и пароль');
  const user=Object.values(state.users).find(u=>u.username===username&&u.active);
  const salt=user?.salt||'not-a-user';const actual=crypto.scryptSync(password,salt,64);
  if(!user||!crypto.timingSafeEqual(actual,Buffer.from(user.digest,'hex'))){attempt.count++;attempts.set(ip,attempt);throw fail(401,'Неверный логин или пароль');}
  attempts.delete(ip);addSession(res,{user:user.id,expires:Date.now()+(remember?30*day:12*3600000)},remember);res.json({ok:true});
});
app.post('/api/activate',body,(req,res)=>{
  const {token,password}=req.body||{};
  if(typeof token!=='string'||!/^[-\w]{43}$/.test(token)||typeof password!=='string'||password.length<12||password.length>512)throw fail(400,'Укажите приглашение и пароль от 12 символов');
  const activation=Object.values(state.activations).find(a=>a.hash===digest(token)&&!a.used&&a.expires>Date.now());
  if(!activation)throw fail(410,'Приглашение отключено или срок действия закончился');
  const user=access.user(activation.user);Object.assign(user,passwordHash(password),{active:true});activation.used=true;
  addSession(res,{user:user.id,expires:Date.now()+30*day});res.json({ok:true,username:user.username});
});
app.post('/api/logout',(req,res)=>{
  const raw=String(req.headers.cookie||'').split(';').map(x=>x.trim()).find(x=>x.startsWith(cookieName+'='))?.slice(cookieName.length+1);
  if(raw){delete state.sessions[digest(raw)];access.save();}
  for(const c of sockets)if(c.session===req.session)c.client.close(1008,'Logged out');
  res.setHeader('Set-Cookie',`${cookieName}=; Path=/; HttpOnly${secureCookies?'; Secure':''}; SameSite=Lax; Max-Age=0`);res.json({ok:true});
});
app.get('/api/boards',member,(req,res)=>res.json(access.list(req.session)));
app.post('/api/boards',member,body,(req,res)=>res.status(201).json(access.create(req.session,req.body||{})));
app.get('/api/users',member,(req,res)=>res.json(Object.values(state.users).map(u=>({id:u.id,name:u.name,pending:!u.active}))));
app.get('/api/boards/:id/access',member,(req,res)=>{
  const board=access.board(req.params.id);owner(req,board);
  res.json({owner:board.owner,grants:board.grants});
});
app.put('/api/boards/:id/access',member,body,(req,res)=>{
  const board=access.board(req.params.id);owner(req,board);const {user,role}=req.body||{};
  if(!access.user(user)||user===board.owner||!['view','edit','none'].includes(role))throw fail(400,'Проверьте пользователя и права');
  if(role==='none')delete board.grants[user];else board.grants[user]=role;
  access.save();changed(board);res.json({ok:true});
});
app.get('/api/tokens',member,(req,res)=>res.json(Object.values(state.tokens).filter(t=>t.user===req.session.user).map(({id,label,created,revoked})=>({id,label,created,revoked}))));
app.post('/api/tokens',member,body,(req,res)=>{const label=req.body?.label||'Codex';if(typeof label!=='string'||label.length>120)throw fail(400,'Проверьте название');res.status(201).json(access.token(req.session.user,label));});
app.delete('/api/tokens/:id',member,(req,res)=>{
  const token=Object.hasOwn(state.tokens,req.params.id)&&state.tokens[req.params.id];if(!token||token.user!==req.session.user)throw fail(404,'Ключ не найден');token.revoked=true;access.save();res.json({ok:true});
});
function cleanInvite(i){return {id:i.id,board:i.board,label:i.label,created:i.created,expires:i.expires,revoked:!!i.revoked,role:'view'};}
app.get('/api/invitations',member,(req,res)=>res.json(Object.values(state.invitations).filter(i=>access.board(i.board)?.owner===req.session.user).map(cleanInvite)));
app.post('/api/invitations',member,body,(req,res)=>{
  const {board:id,label='',days=7}=req.body||{};const board=access.board(id);owner(req,board);
  if(typeof label!=='string'||label.length>120||![0,1,7,30].includes(days))throw fail(400,'Проверьте параметры ссылки');
  const raw=secret();const invitation={id:crypto.randomUUID(),board:id,label:label.trim()||'Гостевая ссылка',digest:digest(raw),created:Date.now(),expires:days?Date.now()+days*day:null,revoked:false};
  state.invitations[invitation.id]=invitation;access.save();res.status(201).json({...cleanInvite(invitation),url:origin+'/invite#'+raw});
});
app.delete('/api/invitations/:id',member,(req,res)=>{
  const invitation=Object.hasOwn(state.invitations,req.params.id)&&state.invitations[req.params.id];if(!invitation)throw fail(404,'Ссылка не найдена');owner(req,access.board(invitation.board));
  invitation.revoked=true;access.save();for(const c of sockets)if(c.session.invitation===invitation.id)c.client.close(1008,'Access revoked');res.json({ok:true});
});
app.post('/api/invitations/redeem',body,(req,res)=>{
  const raw=req.body?.token;if(typeof raw!=='string'||!/^[-\w]{43}$/.test(raw))throw fail(400,'Некорректная ссылка');
  const i=Object.values(state.invitations).find(i=>i.digest===digest(raw));if(!i||i.revoked||i.expires&&i.expires<=Date.now())throw fail(410,'Ссылка отключена или срок доступа закончился');
  if(!access.permission(req.session,access.board(i.board)))addSession(res,{role:'view',board:i.board,invitation:i.id,expires:Math.min(i.expires||Date.now()+30*day,Date.now()+30*day)});
  res.json({url:`/b/${i.board}/`});
});
async function proxy(req,res,board,target,session=req.session){
  const reading=['GET','HEAD'].includes(req.method)||req.method==='POST'&&target.split('?')[0]==='/api/export/image';
  const {port:workerPort,release}=await acquireAuthorizedWorker({workers,access,session,board,write:!reading});
  const headers={...req.headers,host:'127.0.0.1'};for(const h of ['cookie','authorization','connection'])delete headers[h];
  const upstream=http.request({hostname:'127.0.0.1',port:workerPort,method:req.method,path:target,headers},response=>{
    const copied={...response.headers,'cache-control':'no-store','referrer-policy':'no-referrer','x-content-type-options':'nosniff'};for(const h of ['set-cookie','access-control-allow-origin'])delete copied[h];
    res.writeHead(response.statusCode,copied);response.pipe(res);
  });
  const done=()=>{release();upstream.destroy();};res.once('close',done);
  upstream.setTimeout(90000,()=>upstream.destroy());upstream.on('error',()=>{if(!res.headersSent)res.status(502).json({error:'Доска временно недоступна'});else res.destroy();});
  req.on('aborted',()=>upstream.destroy());req.pipe(upstream);
}
app.use('/internal/:cap',asyncRoute(async(req,res)=>{
  const job=mcp.jobs.get(req.params.cap);if(!job||!access.tokenValid(job.session))throw fail(401,'Доступ закрыт');
  const normalized=new URL(req.url,'http://internal').pathname;
  if(normalized!==req.path||(!normalized.startsWith('/api/')&&normalized!='/health'))throw fail(403,'Недопустимый адрес');
  const reading=['GET','HEAD'].includes(req.method)||req.method==='POST'&&normalized==='/api/export/image';
  access.require(job.session,job.board,!reading);if(job.readOnly&&!reading)throw fail(403,'Разрешён только просмотр');
  await proxy(req,res,job.board,req.url,job.session);
}));
app.use(asyncRoute(async(req,res,next)=>{
  const match=/^\/b\/([a-z0-9-]+)(\/.*)?$/.exec(req.path);if(!match)return next();
  const board=access.board(match[1]),role=access.permission(req.session,board);
  if(!role){if(!req.session&&req.method==='GET'&&(!match[2]||match[2]==='/'))return res.redirect('/login?next='+encodeURIComponent(`/b/${match[1]}/`));throw fail(req.session?403:401,'Доступ к доске закрыт');}
  if(!match[2])return res.redirect(`/b/${board.id}/`);
  const target=match[2];if(new URL(target,'http://internal').pathname!==target)throw fail(400,'Недопустимый адрес');
  if(target==='/api/board-config'&&req.method==='GET')return res.json({...access.publicBoard(req.session,board),member:!!req.session.user});
  const staticPath=target==='/'||target.startsWith('/assets/');
  const readPath=['/api/elements','/api/files','/health'].includes(target);
  if(role==='view'&&(!['GET','HEAD'].includes(req.method)||!staticPath&&!readPath))throw fail(403,'Разрешён только просмотр этой доски');
  if(!staticPath&&!target.startsWith('/api/')&&target!='/health')throw fail(404,'Страница не найдена');
  await proxy(req,res,board,target+(req.url.includes('?')?'?'+req.url.split('?').slice(1).join('?'):''));
}));
app.use('/portal',express.static(path.join(here,'static'),{index:false,dotfiles:'deny'}));
app.get(['/','/login','/invite','/activate','/settings'],(req,res)=>{
  if(req.path==='/'&&req.session&&!req.session.user)return res.redirect(`/b/${req.session.board}/`);
  res.sendFile(path.join(here,'static/index.html'));
});
app.use((req,res)=>res.status(404).json({error:'Страница не найдена'}));
app.use((error,req,res,next)=>{if(res.headersSent)return next(error);res.status(error.status||500).json({error:error.status&&error.status!==500?error.message:'Не удалось выполнить запрос'});});
const server=http.createServer(app),wss=new WebSocketServer({noServer:true,maxPayload:1024*1024});
server.on('upgrade',async(req,socket,head)=>{
  if(stopping){socket.end('HTTP/1.1 503 Service Unavailable\r\nConnection: close\r\n\r\n');return;}
  const match=/^\/b\/([a-z0-9-]+)\/ws$/.exec(req.url),board=match&&access.board(match[1]),session=sessionOf(req);
  if(!board||!access.permission(session,board)||req.headers.origin!==origin){socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');return;}
  try{
    const {port:workerPort,release}=await workers.acquire(board);if(!access.permission(session,board)){release();throw fail(403,'Доступ закрыт');}
    wss.handleUpgrade(req,socket,head,client=>{
      const upstream=new WebSocket(`ws://127.0.0.1:${workerPort}/`),connection={client,upstream,session,board,role:access.permission(session,board)};sockets.add(connection);
      const stop=()=>{sockets.delete(connection);release();upstream.terminate();};
      upstream.on('message',(message,binary)=>{if(!access.permission(session,board))return client.close(1008,'Access expired');if(client.readyState===WebSocket.OPEN)client.send(message,{binary});});
      client.on('message',(message,binary)=>{const role=access.permission(session,board);if(!role)return client.close(1008,'Access expired');if(role!=='view'&&upstream.readyState===WebSocket.OPEN)upstream.send(message,{binary});});
      upstream.on('error',()=>client.close(1011,'Board unavailable'));upstream.on('close',()=>{if(client.readyState===WebSocket.OPEN)client.close(1001,'Board disconnected');});
      client.on('error',stop);client.on('close',stop);
    });
  }catch{socket.end('HTTP/1.1 503 Service Unavailable\r\nConnection: close\r\n\r\n');}
});
setInterval(()=>{for(const c of sockets)if(!access.permission(c.session,c.board))c.client.close(1008,'Access expired');for(const [ip,a]of attempts)if(a.until<=Date.now())attempts.delete(ip);},30000).unref();
server.on('error',error=>{console.error(error.code==='EADDRINUSE'?'Portal port is already in use; no other process was stopped.':error.message);process.exit(1);});
server.listen(port,config.host,()=>console.log('Private boards portal v2 ready'));
const shutdown=async()=>{if(stopping)return;stopping=true;const drained=new Promise(resolve=>server.close(resolve));for(const c of sockets){c.client.close();c.upstream.terminate();}await workers.close();await drained;process.exit(0);};
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,shutdown);
process.on('message',m=>{if(m?.type==='portal:shutdown')void shutdown();});
