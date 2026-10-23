import {loadConfig} from '../portal/config.mjs';
try{const c=loadConfig();if(c.localDemo)console.log(`Local demo: ${c.origin}. Credentials remain in .local/demo-credentials.json.`);await import('../portal/server.mjs');}catch(error){console.error(error.message);process.exitCode=1;}
