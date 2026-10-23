import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
const index=process.argv.indexOf('--root');
const root=index>=0?path.resolve(process.argv[index+1]):path.resolve(import.meta.dirname,'..');
const result=spawnSync('git',['ls-files','-z'],{cwd:root,encoding:'utf8'});
if(result.status!==0)throw new Error('Cannot inspect tracked files');
const allowed=/^(?:portal\/|scripts\/|tests\/|examples\/|patches\/|docs\/|deploy\/|README\.md$|LICENSE$|THIRD_PARTY_NOTICES\.md$|\.gitignore$|package(?:-lock)?\.json$|upstream\.lock\.json$|config\.example\.json$)/;
const forbidden=/(?:^|\/)(?:\.private|\.local|\.vendor|node_modules|\.superpowers|release|backups?)(?:\/|$)|(?:^|\/)(?:auth\.json|boards\.json|config\.local\.json)|\.(?:log|key|pem|zip|tar|gz)$/i;
let count=0;
for(const name of result.stdout.split('\0').filter(Boolean)){
 if(!allowed.test(name)||forbidden.test(name))throw new Error(`Forbidden tracked path: ${name}`);
 const file=path.join(root,name);
 if(fs.lstatSync(file).isSymbolicLink())throw new Error(`Symlink is not public: ${name}`);
 if(/\.(?:png|jpg|jpeg|webp)$/i.test(name))continue;
 const text=fs.readFileSync(file,'utf8');
 if(/-----BEGIN (?:RSA |OPENSSH |EC )?PRIVATE KEY-----|\bsk-proj-[A-Za-z0-9_-]{20,}/.test(text)&&!name.startsWith('tests/')&&!name.endsWith('check-public.mjs'))throw new Error(`Potential secret in ${name} (value suppressed)`);
 count++;
}
console.log(`Public file check passed: ${count} text files inspected; inspect content and history before publishing.`);
