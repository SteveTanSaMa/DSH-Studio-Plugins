import assert from 'node:assert/strict';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {createRequire} from 'node:module';
import {parse as parseYAML} from 'yaml';
import {boot,createRuntimeResolution,initProfile,loadProfileDirectory,PluginPackages,readProfilePatches} from '@deepseek-ai/dsh-app-boot';
import {root,indexURL} from './build.mjs';
const require=createRequire(import.meta.url);
const runtime=join(require.resolve('@deepseek-ai/dsh/package.json'),'..');
const home=join(root,'TestRuntime','home');
const profileDir=join(home,'profiles','web');
const pnpm=join(root,'node_modules','pnpm','bin','pnpm.mjs');
await mkdir(home,{recursive:true});
await mkdir(join(root,'TestRuntime','workspace'),{recursive:true});
process.env.DSH_HOME=home;process.env.DSH_TELEMETRY_DISABLED='1';
const marketBundle='@deepseek-ai/dsh-experimental-plugin-market-bundle';
let exists=true;try{await readFile(join(profileDir,'package.json'));}catch(error){if(error.code==='ENOENT')exists=false;else throw error;}
if(!exists)initProfile(profileDir,[marketBundle]);
await writeFile(join(home,'empty.npmrc'),'');
await writeFile(join(profileDir,'cordis.yml'),'[]\n');
// The test runner writes only its own fixed test profile.
await writeFile(join(profileDir,'cordis.patch.yml'),JSON.stringify([{insert:[
 {id:'config-editor',name:'@deepseek-ai/dsh-config-editor'},
 {id:'settings',name:'@deepseek-ai/dsh-settings'},
 {id:'plugin-manager',name:'@deepseek-ai/dsh-plugin-manager',config:{pnpmCommand:pnpm,registry:'https://registry.npmjs.org/',fallbackRegistries:[],idleTimeoutMs:60000,inspectTimeoutMs:15000}}
]}]));
const workspace=parseYAML(await readFile(join(profileDir,'pnpm-workspace.yaml'),'utf8'));
await writeFile(join(profileDir,'pnpm-workspace.yaml'),JSON.stringify({...workspace,registry:'https://registry.npmjs.org/',
 storeDir:join(root,'TestRuntime','store'),cacheDir:join(root,'TestRuntime','cache'),stateDir:join(root,'TestRuntime','state'),
 ignoreScripts:true,fetchRetries:1,fetchTimeout:30000,updateNotifier:false}));
const manifest=JSON.parse(await readFile(join(profileDir,'package.json')));
// Use the minimal manager composition during package operations; actual activation is tested in the complete Web app.
manifest.dsh.profile.bundles=[marketBundle];await writeFile(join(profileDir,'package.json'),JSON.stringify(manifest,null,2));
const anchor=join(runtime,'package.json');
const loaded=loadProfileDirectory('studio-candidate-check',profileDir,anchor);
const resolution=await createRuntimeResolution({installAnchor:anchor,profile:loaded,home});
const profile={name:'web',dir:profileDir,home,cwd:join(root,'TestRuntime','workspace'),startedBundles:[marketBundle],
 patchPath:join(profileDir,'cordis.patch.yml'),installAnchor:anchor,overlays:[],telemetryDisabledEnv:'1',
 packageManager:{command:pnpm,env:{XDG_CONFIG_HOME:join(root,'TestRuntime','config'),XDG_CACHE_HOME:join(root,'TestRuntime','cache'),
 npm_config_userconfig:join(home,'empty.npmrc'),npm_config_globalconfig:join(home,'empty.npmrc')}}};
const ctx=await boot('studio-candidate-check',join(profileDir,'cordis.yml'),readProfilePatches('studio-candidate-check',profile,loaded),async ctx=>{
 ctx.provide('profileContext',profile);ctx.provide('appReady',{onReady:fn=>{fn();return()=>{};}});await ctx.plugin(PluginPackages,{resolution});
});
const results=[];
try{
 const config=JSON.parse(await readFile(join(root,'data','sources.json')));
 await ctx.pluginMarket.setIndexes([indexURL]);
 const listing=await ctx.pluginMarket.search(indexURL,{offset:0,limit:10,sort:{kind:'index'},refresh:true});
 for(const pin of config.packages){
  const entry=listing.entries.find(entry=>entry.name===pin.name);
  assert.equal(entry?.defaultVersion,pin.version);
  const target=entry.versions.find(version=>version.version===pin.version).install;
  console.log('Installing exact candidate:',target.spec);
  const result=await ctx.pluginManager.installBundle(target.spec,{registry:target.registry,saveExact:true,enabled:false});
  const record={name:pin.name,version:pin.version,application:result.application,error:result.error,
   packageExitCode:result.packageResult?.exitCode,pendingBuilds:result.pendingBuilds};
  results.push(record);
  await writeFile(join(root,'TestRuntime','install-results.json'),JSON.stringify({checkedAt:new Date().toISOString(),node:process.version,platform:process.platform,architecture:process.arch,results},null,2));
  if(result.error){console.log('Installation outcome:',JSON.stringify(record));continue;}
  const installed=JSON.parse(await readFile(join(profileDir,'node_modules',pin.name,'package.json')));
  assert.equal(installed.version,pin.version);
  console.log('Installed, disabled:',pin.name,pin.version);
 }
}finally{await ctx.fiber.dispose();}
// Full Web composition. Keep candidates off until they are explicitly enabled for acceptance.
const finalManifest=JSON.parse(await readFile(join(profileDir,'package.json')));
finalManifest.dsh.profile.bundles=['@deepseek-ai/dsh-base','@deepseek-ai/dsh-web-app',marketBundle];
await writeFile(join(profileDir,'package.json'),JSON.stringify(finalManifest,null,2)+'\n');
await writeFile(join(profileDir,'cordis.patch.yml'),JSON.stringify([
 {id:'plugin-manager',config:{pnpmCommand:pnpm,registry:'https://registry.npmjs.org/',fallbackRegistries:[],idleTimeoutMs:60000,inspectTimeoutMs:15000}},
 {id:'plugin-market',config:{indexes:[indexURL]}},
 {id:'product-analytics',config:{enabled:false}},
 {id:'deepseek-account',config:{desktopPlatform:'darwin'}}
],null,2)+'\n');
console.log('Candidate files retained in TestRuntime/');
if(results.some(result=>result.error))process.exitCode=1;
