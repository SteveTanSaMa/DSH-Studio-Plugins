import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {mkdir,writeFile,appendFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {join,dirname} from 'node:path';
import {root} from './build.mjs';
const require=createRequire(import.meta.url);
const directory=join(root,'TestRuntime');
const home=join(directory,'home');
await mkdir(directory,{recursive:true});
const child=spawn(process.execPath,[join(dirname(require.resolve('@deepseek-ai/dsh/package.json')),'lib','bin.js'),'web','--host','127.0.0.1','--port','0','--no-open'],{
 cwd:join(directory,'workspace'),detached:true,stdio:['ignore','pipe','pipe'],
 env:{...process.env,DSH_HOME:home,DSH_TELEMETRY_DISABLED:'1',NARB_DISABLE_NATIVE_CACHE:'1',
 XDG_CONFIG_HOME:join(directory,'config'),XDG_CACHE_HOME:join(directory,'cache'),
 npm_config_userconfig:join(home,'empty.npmrc'),npm_config_globalconfig:join(home,'empty.npmrc')}
});
const closed=once(child,'close');
let buffer='',ready=false,stopping=false,timer;
const redact=text=>text.replace(/(http:\/\/127\.0\.0\.1:\d+)\S*/g,'$1/[private-url]').replace(/([?&](?:token|access_token)=)[^\s&]+/g,'$1[redacted]');
const log=chunk=>{void appendFile(join(directory,'web.log'),redact(chunk.toString()),{mode:0o600});};
child.stderr.on('data',log);
child.stdout.on('data',chunk=>{
 log(chunk);buffer=(buffer+chunk.toString()).slice(-65536);
 const url=buffer.match(/dsh web: (http:\/\/127\.0\.0\.1:\d+[^\s]*)[\r\n]/)?.[1];
 if(url&&!ready){ready=true;void writeFile(join(directory,'ready.json'),JSON.stringify({url,pid:child.pid,launcherPid:process.pid}),{mode:0o600})
 .then(()=>console.log('Candidate Web ready. Connection details: TestRuntime/ready.json; logs: TestRuntime/web.log'))
 .catch(()=>stop());}
});
function stop(){
 if(stopping)return;stopping=true;
 try{process.kill(-child.pid,'SIGTERM');}catch{}
 timer=setTimeout(()=>{try{process.kill(-child.pid,'SIGKILL');}catch{}},10000);timer.unref();
}
process.on('SIGINT',stop);process.on('SIGTERM',stop);
const startup=setTimeout(()=>{if(!ready){console.error('Candidate Web failed to become ready; inspect TestRuntime/web.log');stop();}},60000);
const [code]=await closed;clearTimeout(timer);clearTimeout(startup);
if(!stopping)process.exitCode=code||1;
console.log('Candidate Web stopped; TestRuntime/ files retained.');
