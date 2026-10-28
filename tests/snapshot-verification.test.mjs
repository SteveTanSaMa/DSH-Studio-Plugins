import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdir,mkdtemp,readFile,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test from 'node:test';
import {buildIndex,candidateDescription,matchingVerification} from '../scripts/build.mjs';
import {saveSnapshot,restoreSnapshot} from '../scripts/snapshot.mjs';

async function fixture(t){
 const directory=await mkdtemp(join(tmpdir(),'studio-index-snapshot-verification-'));
 t.after(()=>rm(directory,{recursive:true,force:true}));
 for(const dir of ['data','public']) await mkdir(join(directory,dir));
 const registry='https://registry.npmjs.org/';
 const runtimeVersion='0.2.1-rc.2';
 const packages=['fixture-alpha','fixture-beta'].map(name=>({name,version:'1.0.0',
  integrity:'sha512-'+createHash('sha512').update(name).digest('base64')}));
 const records=packages.map(pin=>({...pin,runtimeVersion,nodeVersion:'26.12.1',platform:'macos',architecture:'arm64',
  checkedAt:'2026-10-23T00:00:00.000Z',checks:{installation:'passed'}}));
 const curation=Object.fromEntries(packages.map(pin=>[pin.name,{title:{en:pin.name},description:{en:'Fixture.',zh:'测试插件。'},category:'usage'}]));
 const index=buildIndex(packages.map(pin=>({name:pin.name,title:{en:pin.name},
  versions:[{version:pin.version,publishTimestamp:1792195200,source:{type:'npm',registry},engines:{dsh:'>=0.2.1-0 <0.3.0-0'}}]})));
 const status={schema:1,runtimeVersion,packages:packages.map((pin,i)=>({...pin,functionalTest:'partial',verification:[records[i]]}))};
 for(const [file,value] of [['data/sources.json',{format:1,runtimeVersion,registry,packages}],['data/curation.json',curation],
  ['data/withdrawn.json',{packages:[]}],['data/verification.json',{schema:1,records}],['public/index.json',index],['public/status.json',status]])
  await write(directory,file,value);
 return directory;
}
const read=async(dir,file)=>JSON.parse(await readFile(join(dir,file),'utf8'));
const write=async(dir,file,value)=>writeFile(join(dir,file),JSON.stringify(value,null,2)+'\n');
function updatedRecord(record){
 return {...record,version:'9.9.9',checkedAt:'2026-10-28T00:00:00.000Z'};
}

test('rollback restores tested-version evidence while keeping evidence added after the snapshot',async t=>{
 const dir=await fixture(t);
 const sources=await read(dir,'data/sources.json');
 const original=await read(dir,'data/verification.json');
 await saveSnapshot('baseline',dir);
 const added=updatedRecord(original.records[0]);
 await write(dir,'data/verification.json',{schema:1,records:[added]});
 const newer=structuredClone(sources);newer.packages[0].version=added.version;
 await write(dir,'data/sources.json',newer);
 await restoreSnapshot('baseline',dir);
 const recovered=await read(dir,'data/verification.json');
 assert.equal(recovered.records.length,original.records.length+1);
 assert.deepEqual(matchingVerification(sources.packages[0],sources.runtimeVersion,recovered.records),[original.records[0]]);
 assert.ok(recovered.records.some(record=>record.version===added.version));
 assert.equal((await read(dir,'data/sources.json')).packages[0].version,sources.packages[0].version);
});

test('old snapshot recovers evidence embedded in its status and preserves current records',async t=>{
 const dir=await fixture(t);const sources=await read(dir,'data/sources.json');
 const original=await read(dir,'data/verification.json');
 const file=await saveSnapshot('legacy',dir);const snapshot=JSON.parse(await readFile(file,'utf8'));
 delete snapshot.payload.verification;
 snapshot.sha256=createHash('sha256').update(JSON.stringify(snapshot.payload)).digest('hex');
 await writeFile(file,JSON.stringify(snapshot));
 const added=updatedRecord(original.records[0]);
 await write(dir,'data/verification.json',{schema:1,records:[added]});
 await restoreSnapshot('legacy',dir);
 const recovered=await read(dir,'data/verification.json');
 assert.deepEqual(matchingVerification(sources.packages[0],sources.runtimeVersion,recovered.records),[original.records[0]]);
 assert.ok(recovered.records.some(record=>record.version===added.version));
});

test('current withdrawal prevents restoration before sources or verification are changed',async t=>{
 const dir=await fixture(t);const sources=await read(dir,'data/sources.json');
 const before=await read(dir,'data/verification.json');await saveSnapshot('withdrawn',dir);
 const withdrawn={packages:[{name:sources.packages[0].name,reason:'withdrawal'}]};
 await write(dir,'data/withdrawn.json',withdrawn);
 await assert.rejects(restoreSnapshot('withdrawn',dir),/withdrawn candidate/);
 assert.deepEqual(await read(dir,'data/verification.json'),before);
 assert.deepEqual(await read(dir,'data/withdrawn.json'),withdrawn);
 assert.deepEqual(await read(dir,'data/sources.json'),sources);
});

test('current correction wins over an older record for the same test identity',async t=>{
 const dir=await fixture(t);const original=await read(dir,'data/verification.json');
 await saveSnapshot('correction',dir);
 const corrected=structuredClone(original);corrected.records[0].checks.installation='corrected';
 await write(dir,'data/verification.json',corrected);await restoreSnapshot('correction',dir);
 const recovered=await read(dir,'data/verification.json');
 assert.equal(recovered.records.length,original.records.length);
 assert.equal(recovered.records.find(item=>item.name===corrected.records[0].name).checks.installation,'corrected');
 const status=await read(dir,'public/status.json');
 assert.equal(status.packages.find(item=>item.name===corrected.records[0].name).verification[0].checks.installation,'corrected');
});

test('legacy fixed suffix is removed and restored descriptions reflect current evidence',async t=>{
 const dir=await fixture(t);const sources=await read(dir,'data/sources.json');
 const original=await read(dir,'data/verification.json');
 const name=sources.packages[0].name;
 const curation=await read(dir,'data/curation.json');
 const oldSuffix={en:'Installation, Web loading and removal checked on macOS arm64; full functional testing pending.',
  zh:'已在 macOS arm64 验证安装、Web 加载及卸载，完整功能待验收。'};
 curation[name].description={en:`Fixture. ${oldSuffix.en}`,zh:`测试插件。${oldSuffix.zh}`};
 await write(dir,'data/curation.json',curation);
 const file=await saveSnapshot('legacy-copy',dir);
 const snapshot=JSON.parse(await readFile(file,'utf8'));
 delete snapshot.payload.verification;
 snapshot.payload.index.description={en:'Private index prototype.',zh:'私有索引原型。'};
 snapshot.payload.index.title={en:'Old title',zh:'旧标题'};
 snapshot.payload.index.metadata={};
 snapshot.sha256=createHash('sha256').update(JSON.stringify(snapshot.payload)).digest('hex');
 await writeFile(file,JSON.stringify(snapshot));
 const corrected=structuredClone(original);
 corrected.records[0].checks.installation='failed';
 await write(dir,'data/verification.json',corrected);
 await restoreSnapshot('legacy-copy',dir);
 const restoredCuration=await read(dir,'data/curation.json');
 const restoredIndex=await read(dir,'public/index.json');
 const restoredRecords=await read(dir,'data/verification.json');
 const generatedHeader=buildIndex(restoredIndex.plugins);
 assert.deepEqual(restoredIndex.title,generatedHeader.title);
 assert.deepEqual(restoredIndex.description,generatedHeader.description);
 assert.deepEqual(restoredIndex.metadata,generatedHeader.metadata);
 const matches=matchingVerification(sources.packages[0],sources.runtimeVersion,restoredRecords.records);
 assert.deepEqual(restoredCuration[name].description,{en:'Fixture.',zh:'测试插件。'});
 const description=restoredIndex.plugins.find(item=>item.name===name).description;
 assert.deepEqual(description,candidateDescription(restoredCuration[name].description,matches));
 assert.match(description.en,/have not all been verified/);
 assert.match(description.zh,/尚未完成/);
 assert.equal(description.en.includes(oldSuffix.en),false);
 assert.equal(description.zh.includes(oldSuffix.zh),false);
});
