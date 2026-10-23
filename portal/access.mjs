import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

export const digest = text => crypto.createHash('sha256').update(text).digest('hex');
export const secret = () => crypto.randomBytes(32).toString('base64url');
export const fail = (status, message) => Object.assign(new Error(message), { status });
export function atomicJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive:true, mode:0o700 });
  const tmp=file+'.'+process.pid+'.tmp'; const fd=fs.openSync(tmp,'w',0o600);
  try { fs.writeFileSync(fd,JSON.stringify(value));fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
  fs.renameSync(tmp,file);
}
export function passwordHash(password) { const salt=crypto.randomBytes(16).toString('hex');return {salt,digest:crypto.scryptSync(password,salt,64).toString('hex')}; }
export class Access {
  constructor(file, boards) {
    this.file=file;this.state=JSON.parse(fs.readFileSync(file,'utf8'));
    if(this.state.version===1) {
      const old=this.state;
      this.state={version:2,users:{dmitry:{id:'dmitry',name:'Дмитрий',...old.owner,active:true}},boards:Object.fromEntries(boards.map(board=>[board.id,{...board,owner:'dmitry',grants:{},created:Date.now()}])),sessions:old.sessions,invitations:old.invitations,tokens:{},activations:{}};
      for(const session of Object.values(this.state.sessions))if(session.role==='owner'){session.user='dmitry';delete session.role;}
      this.save();
    }
    if(this.state.version!==2)throw new Error('Unsupported access state');
  }
  save(){atomicJson(this.file,this.state);}
  user(id){return Object.hasOwn(this.state.users,id)?this.state.users[id]:null;}
  board(id){return Object.hasOwn(this.state.boards,id)?this.state.boards[id]:null;}
  valid(session){
    if(!session||session.expires<=Date.now())return false;
    if(session.user)return !!this.user(session.user)?.active;
    const invite=this.state.invitations[session.invitation];
    return !!invite&&!invite.revoked&&(!invite.expires||invite.expires>Date.now())&&invite.board===session.board;
  }
  permission(session,board){
    if(!this.valid(session)||!board)return null;
    if(session.user){if(board.owner===session.user)return 'owner';return board.grants[session.user]||null;}
    return session.board===board.id?'view':null;
  }
  require(session,board,edit=false){const role=this.permission(session,board);if(!role||edit&&role==='view')throw fail(403,'Нет доступа к этому действию');return role;}
  publicBoard(session,board){const role=this.permission(session,board);return {id:board.id,name:board.name,description:board.description||'',color:board.color||'#326c96',url:`/b/${board.id}/`,role,ownerName:this.user(board.owner)?.name||'',sections:board.sections||[],shared:!!Object.keys(board.grants).length||Object.values(this.state.invitations).some(i=>i.board===board.id&&!i.revoked&&(!i.expires||i.expires>Date.now()))};}
  list(session){return Object.values(this.state.boards).filter(b=>this.permission(session,b)).map(b=>this.publicBoard(session,b));}
  create(session,{name,description=''}){
    if(!session.user||!this.valid(session))throw fail(403,'Нужна личная учётная запись');
    if(typeof name!=='string'||!name.trim()||name.length>120||typeof description!=='string'||description.length>500)throw fail(400,'Укажите название до 120 символов');
    const id='b-'+crypto.randomBytes(8).toString('hex');
    const board={id,name:name.trim(),description:description.trim(),owner:session.user,grants:{},sections:[],created:Date.now(),color:'#557566'};
    this.state.boards[id]=board;this.save();return this.publicBoard(session,board);
  }
  token(user,label='Codex'){
    const raw=secret(),id=crypto.randomUUID();this.state.tokens[id]={id,user,label,hash:digest(raw),created:Date.now(),revoked:false};this.save();return {id,token:raw};
  }
  bearer(raw){if(typeof raw!=='string'||!/^[\w-]{43}$/.test(raw))return null;const hash=digest(raw);const token=Object.values(this.state.tokens).find(t=>!t.revoked&&t.hash===hash);return token&&this.user(token.user)?.active?{user:token.user,expires:Number.MAX_SAFE_INTEGER,tokenId:token.id}:null;}
  tokenValid(session){return this.valid(session)&&(!session.tokenId||!this.state.tokens[session.tokenId]?.revoked);}
}
