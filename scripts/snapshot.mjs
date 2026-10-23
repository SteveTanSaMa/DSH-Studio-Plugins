import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {parseMarketIndex} from '@deepseek-ai/dsh-plugin-market-index';
import {root,indexURL,validateSelection} from './build.mjs';
const readJSON=async file=>JSON.parse(await readFile(file,'utf8'));
const digest=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
function validate(payload,withdrawn){
 validateSelection(payload.sources,withdrawn);
 const index=parseMarketIndex(payload.index,indexURL);
 assert.equal(index.plugins.length,payload.sources.packages.length,'snapshot candidate count mismatch');
 assert.equal(payload.status.packages.length,payload.sources.packages.length,'snapshot evidence count mismatch');
 for(const pin of payload.sources.packages){
  const plugin=index.plugins.find(item=>item.name===pin.name);
  assert.ok(plugin&&plugin.versions.length===1&&plugin.versions[0].version===pin.version,'snapshot version mismatch');
  assert.equal(plugin.versions[0].source.registry,payload.sources.registry);
  const evidence=payload.status.packages.find(item=>item.name===pin.name);
  assert.equal(evidence?.version,pin.version);assert.equal(evidence?.integrity,pin.integrity);
  assert.ok(payload.curation[pin.name]);
 }
}
function location(directory,label){
 assert.match(label,/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,63}$/,'safe snapshot label required');
 return join(directory,'TestRuntime','snapshots',label+'.json');
}
export async function saveSnapshot(label,directory=root){
 const payload=Object.fromEntries(await Promise.all([
  ['sources','data/sources.json'],['curation','data/curation.json'],['index','public/index.json'],['status','public/status.json']
 ].map(async([key,file])=>[key,await readJSON(join(directory,file))])));
 validate(payload,await readJSON(join(directory,'data/withdrawn.json')));
 const file=location(directory,label);await mkdir(join(directory,'TestRuntime','snapshots'),{recursive:true});
 await writeFile(file,JSON.stringify({schema:1,createdAt:new Date().toISOString(),sha256:digest(payload),payload},null,2)+'\n',{flag:'wx'});
 return file;
}
export async function restoreSnapshot(label,directory=root){
 const snapshot=await readJSON(location(directory,label));
 assert.equal(snapshot.schema,1);assert.equal(snapshot.sha256,digest(snapshot.payload),'snapshot digest mismatch');
 // Current withdrawals remain authoritative: a rollback must never resurrect a withdrawn package.
 validate(snapshot.payload,await readJSON(join(directory,'data/withdrawn.json')));
 const p=snapshot.payload;
 for(const [file,value] of [['data/sources.json',p.sources],['data/curation.json',p.curation],['public/index.json',p.index],['public/status.json',p.status]])
  await writeFile(join(directory,file),JSON.stringify(value,null,2)+'\n');
 return p.sources.packages.length;
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const [command,label]=process.argv.slice(2);
 assert.ok(label&&['save','restore'].includes(command),'usage: node scripts/snapshot.mjs save|restore LABEL');
 if(command==='save')console.log('Snapshot saved:',await saveSnapshot(label));
 else console.log(`Restored ${await restoreSnapshot(label)} candidates locally. Review git diff before committing; current withdrawals were retained.`);
}
