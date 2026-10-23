import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';

// Audit before pruning: libraries declared as devDependencies are bundled
// into the browser and the Node exporter and must not disappear from the gate.
export function auditDependencies(engine) {
 const npmCli=process.env.npm_execpath||path.join(path.dirname(process.execPath),'node_modules/npm/bin/npm-cli.js');
 const cli=fs.existsSync(npmCli)?process.execPath:'npm';
 const args=fs.existsSync(npmCli)?[npmCli,'audit','--json']:['audit','--json'];
 const result=spawnSync(cli,args,{cwd:engine,encoding:'utf8',windowsHide:true,timeout:180000,maxBuffer:8*1024*1024});
 if(result.error)throw result.error;
 let report;
 try{report=JSON.parse(result.stdout);}catch{throw new Error('Dependency audit did not return a valid report');}
 const counts=report.metadata?.vulnerabilities;
 if(report.error||!counts||!Number.isInteger(counts.total)||result.status!==0||counts.total!==0) {
  throw new Error(`Dependency audit blocked release: ${counts?JSON.stringify(counts):report.error?.summary||result.stderr}`);
 }
 console.log('Dependency audit: 0 known vulnerabilities (full build and runtime tree).');
 return report;
}
if(process.argv[1]&&pathToFileURL(path.resolve(process.argv[1])).href===import.meta.url){
 try{auditDependencies(path.resolve(process.argv[2]||path.join(import.meta.dirname,'../.vendor/upstream')));}catch(error){console.error(error.message);process.exitCode=1;}
}
