import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {parseMarketIndex} from '@deepseek-ai/dsh-plugin-market-index';
import {root,indexURL,buildIndex,matchingVerification,candidateDescription,validateSelection} from './build.mjs';
const readJSON=async file=>JSON.parse(await readFile(file,'utf8'));
const digest=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
async function readVerification(directory){
 try{return await readJSON(join(directory,'data/verification.json'));}
 catch(error){if(error.code==='ENOENT')return {schema:1,records:[]};throw error;}
}
function verificationRecords(value){
 assert.equal(value?.schema,1,'invalid verification schema');
 assert.ok(Array.isArray(value.records),'invalid verification records');
 for(const record of value.records){
  assert.ok(record && typeof record==='object' && !Array.isArray(record),'invalid verification record');
  for(const key of ['name','version','integrity','runtimeVersion','nodeVersion','platform','architecture','checkedAt'])
   assert.ok(typeof record[key]==='string' && record[key].length>0,`invalid verification ${key}`);
 }
 return value.records;
}
function recordKey(record){
 return JSON.stringify(['name','version','integrity','runtimeVersion','nodeVersion','platform','architecture','checkedAt'].map(key=>record[key]));
}
function mergeVerification(current,saved){
 const records=new Map();
 // Current records win if an identical test identity and timestamp is amended later.
 for(const record of verificationRecords(saved)) records.set(recordKey(record),record);
 for(const record of verificationRecords(current)) records.set(recordKey(record),record);
 return {...current,records:[...records.values()]};
}
function normalizeLegacyDescription(description){
 assert.ok(description && typeof description.en==='string' && typeof description.zh==='string',
  'candidate descriptions require English and Chinese');
 const suffixes={
  en:['Installation, Web loading and removal checked on macOS arm64; full functional testing pending.',
   'Test candidate; installation, Web loading and removal have not all been verified for this version.',
   'Index test candidate; functionality has not been verified by DSH Studio.'],
  zh:['已在 macOS arm64 验证安装、Web 加载及卸载，完整功能待验收。',
   '测试候选，尚未完成该版本的安装、Web 加载和卸载验证。',
   '用于索引链路测试，尚未通过 Studio 功能验证。']
 };
 const normalized={...description};
 for(const language of ['en','zh']){
  // Only remove our own complete suffixes at the end, including repeated
  // suffixes from snapshots produced before descriptions were derived.
  let text=normalized[language].trimEnd();
  for(;;){
   const suffix=suffixes[language].find(item=>text.endsWith(item));
   if(!suffix) break;
   text=text.slice(0,-suffix.length).trimEnd();
  }
  assert.ok(text.length>0,'candidate description cannot be only a verification suffix');
  normalized[language]=text;
 }
 return normalized;
}
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
 payload.verification=await readVerification(directory);
 verificationRecords(payload.verification);
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
 // Older snapshots have no verification file, but may contain the same records
 // in their published status evidence. Recover only records matching their pin.
 const legacyRecords=p.verification ? [] : p.status.packages.flatMap(item=>
  (Array.isArray(item.verification) ? item.verification : []).filter(record=>
   record.name===item.name && record.version===item.version && record.integrity===item.integrity &&
   record.runtimeVersion===p.sources.runtimeVersion));
 const saved=p.verification ?? {schema:1,records:legacyRecords};
 const verification=mergeVerification(await readVerification(directory),saved);
 const status=structuredClone(p.status);
 const curation=structuredClone(p.curation);
 // Rebuild the outer document too: old snapshots may carry an obsolete market
 // title or description even when their plugin records are still valid.
 const index=buildIndex(structuredClone(p.index.plugins));
 for(const pin of p.sources.packages){
  const item=status.packages.find(entry=>entry.name===pin.name);
  const records=matchingVerification(pin,p.sources.runtimeVersion,verification.records);
  item.functionalTest=records.length ? 'partial' : 'not-run';
  if(records.length) item.verification=records; else delete item.verification;
  curation[pin.name].description=normalizeLegacyDescription(curation[pin.name].description);
  index.plugins.find(entry=>entry.name===pin.name).description=candidateDescription(curation[pin.name].description,records);
 }
 parseMarketIndex(index,indexURL);
 for(const [file,value] of [['data/sources.json',p.sources],['data/curation.json',curation],['data/verification.json',verification],['public/index.json',index],['public/status.json',status]])
  await writeFile(join(directory,file),JSON.stringify(value,null,2)+'\n');
 return p.sources.packages.length;
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const [command,label]=process.argv.slice(2);
 assert.ok(label&&['save','restore'].includes(command),'usage: node scripts/snapshot.mjs save|restore LABEL');
 if(command==='save')console.log('Snapshot saved:',await saveSnapshot(label));
 else console.log(`Restored ${await restoreSnapshot(label)} candidates locally. Review git diff before committing; current withdrawals were retained.`);
}
