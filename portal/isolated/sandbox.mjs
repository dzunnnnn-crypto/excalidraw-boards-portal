// Opt-in Linux sandbox. Existing installations keep their current launcher.
import fs from 'node:fs';
import path from 'node:path';

export function sandboxCommand({engine,directory,id,name,command,leaseFile,generation,extraMounts=[]}) {
  if(process.platform!=='linux')throw new Error('Isolation lab requires Linux');
  if(process.getuid()===0)throw new Error('Run the portal and sandbox as an unprivileged user');
  if(!/^[a-z0-9-]{1,80}$/.test(id))throw new Error('Invalid board ID');
  for(const p of [engine,directory])if(!path.isAbsolute(p)||fs.realpathSync(p)!==p)throw new Error('Use canonical absolute directories');
  if(!command&&!leaseFile)throw new Error('Native editor requires a kernel lease');
  if(leaseFile){const stat=fs.lstatSync(leaseFile);if(!stat.isFile()||stat.isSymbolicLink()||stat.nlink!==1||fs.realpathSync(leaseFile)!==leaseFile)throw new Error('Invalid kernel lease file');}
  const args=['--unshare-all','--unshare-user','--disable-userns','--assert-userns-disabled','--die-with-parent','--new-session','--cap-drop','ALL',
    '--ro-bind','/usr','/usr','--symlink','usr/bin','/bin','--symlink','usr/lib','/lib','--symlink','usr/lib64','/lib64',
    '--proc','/proc','--dev','/dev','--tmpfs','/tmp','--dir','/etc',
    '--dir','/runtime','--ro-bind',fs.realpathSync(process.execPath),'/runtime/node',
    '--ro-bind',engine,'/app','--dir','/sandbox','--bind',directory,'/board','--chdir','/board','--clearenv'];
  if(leaseFile)args.push('--dir','/lease','--ro-bind',leaseFile,'/lease/editor.lock');
  // The test probe is a read-only module, never a host directory containing secrets.
  for(const [source,target] of extraMounts)args.push('--ro-bind',source,target);
  const env={PATH:'/runtime:/usr/bin:/bin',HOME:'/board',TMPDIR:'/tmp',LANG:'C.UTF-8',
    HOST:'127.0.0.1',PORT:'61234',BOARD_ID:id,BOARD_TITLE:name,
    EXCALIDRAW_DATA_DIR:'/board/canvas',XDG_STATE_HOME:'/board/runtime',LOG_FILE_PATH:'/board/canvas.log',LOG_LEVEL:'warn',
    EXCALIDRAW_SOCKET_PATH:'/board/editor.sock',EXCALIDRAW_SHUTDOWN_STDIN:'1',
    ...(leaseFile?{EXCALIDRAW_ISOLATED_LEASE:'/lease/editor.lock'}:{}),
    ...(generation?{EXCALIDRAW_WORKER_GENERATION:generation}:{})};
  for(const [key,value] of Object.entries(env))args.push('--setenv',key,String(value));
  args.push('--',...command||['/usr/bin/flock','--exclusive','--nonblock','--conflict-exit-code','73','--no-fork','/lease/editor.lock','/runtime/node','/app/dist/server.js']);
  return {file:'/usr/bin/bwrap',args,options:{cwd:directory,env:{PATH:'/usr/bin:/bin'},stdio:['ignore','ignore','pipe']}};
}
