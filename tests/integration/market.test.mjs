import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { once } from 'node:events';
import { mkdir, mkdtemp, readFile, writeFile, rm, realpath } from 'node:fs/promises';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { c as createTar } from 'tar';
import test from 'node:test';
import { boot, createRuntimeResolution, initProfile, loadProfileDirectory, PluginPackages, readProfilePatches } from '@deepseek-ai/dsh-app-boot';
import { parse as parseYAML } from 'yaml';

const require = createRequire(import.meta.url);
const runtime = fileURLToPath(new URL('.', pathToFileURL(require.resolve('@deepseek-ai/dsh/package.json'))));
const pnpm = fileURLToPath(new URL('../../node_modules/pnpm/bin/pnpm.mjs', import.meta.url));
const marketBundle = '@deepseek-ai/dsh-experimental-plugin-market-bundle';
const fixtureName = 'studio-index-install-fixture';
const query = { offset: 0, limit: 10, sort: { kind: 'index' } };

test('real official Host reads the generated index, persists sources and installs a loopback fixture', { timeout: 120000 }, async t => {
  const home = await realpath(await mkdtemp(join(tmpdir(), 'studio-index-integration-')));
  const roots = new Set(); const hits = new Map(); let origin, tarball, fixtureManifest;
  let document = JSON.parse(await readFile(new URL('../../public/index.json', import.meta.url)));
  const expected = JSON.parse(await readFile(new URL('../../data/sources.json', import.meta.url)));
  const server = createServer((req, res) => {
    hits.set(req.url, (hits.get(req.url) || 0) + 1);
    res.setHeader('Content-Type', 'application/json');
    if (req.url === '/index.json') return res.end(JSON.stringify(document));
    if (req.url === '/redirect') { res.writeHead(302, { location: '/index.json' }); return res.end(); }
    if (req.url === '/invalid') return res.end('{"format":99}');
    if (req.url === '/fixture-index.json') return res.end(JSON.stringify({ format: 1, title: 'Install fixture',
      plugins: [{ name: fixtureName, versions: [{ version: '1.0.0', publishTimestamp: 1792195200,
        source: { type: 'npm', registry: origin + '/' }, engines: { dsh: '>=0.2.1-0 <0.3.0-0' } }] }] }));
    if (req.url === '/' + fixtureName || req.url === '/' + fixtureName + '/1.0.0') {
      const manifest = { ...fixtureManifest, dist: { tarball: origin + '/fixture.tgz',
        integrity: 'sha512-' + createHash('sha512').update(tarball).digest('base64') } };
      return res.end(JSON.stringify({ name: fixtureName, 'dist-tags': { latest: '1.0.0' }, versions: { '1.0.0': manifest } }));
    }
    if (req.url === '/fixture.tgz') { res.setHeader('Content-Type', 'application/octet-stream'); return res.end(tarball); }
    res.writeHead(404); res.end('{}');
  });
  t.after(async () => {
    for (const ctx of roots) await ctx.fiber.dispose();
    server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
    await rm(home, { recursive: true, force: true });
  });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  origin = `http://127.0.0.1:${server.address().port}`;
  const source = origin + '/index.json';
  const packageDir = join(home, 'package'); await mkdir(packageDir);
  fixtureManifest = { name: fixtureName, version: '1.0.0', type: 'module', main: 'index.js',
    engines: { dsh: '>=0.2.1-0 <0.3.0-0' }, dsh: { bundle: { patch: 'cordis.patch.yml' } } };
  await writeFile(join(packageDir, 'package.json'), JSON.stringify(fixtureManifest));
  await writeFile(join(packageDir, 'index.js'), "export default class Fixture { constructor(ctx) { ctx.provide('studioIndexFixture', { active: true }); } }\n");
  await writeFile(join(packageDir, 'cordis.patch.yml'), JSON.stringify([{ insert: [{ id: 'studio-index-fixture', name: fixtureName }] }]));
  const archive = join(home, 'fixture.tgz'); await createTar({ cwd: home, gzip: true, file: archive }, ['package']);
  tarball = await readFile(archive);
  await writeFile(join(home, 'empty.npmrc'), '');
  async function prepare(name) {
    const dir = join(home, 'profiles', name); initProfile(dir, [marketBundle]);
    await writeFile(join(dir, 'cordis.yml'), '[]\n');
    await writeFile(join(dir, 'cordis.patch.yml'), JSON.stringify([{ insert: [
      { id: 'config-editor', name: '@deepseek-ai/dsh-config-editor' },
      { id: 'settings', name: '@deepseek-ai/dsh-settings' },
      { id: 'plugin-manager', name: '@deepseek-ai/dsh-plugin-manager', config: {
        pnpmCommand: pnpm, registry: origin + '/', fallbackRegistries: [], idleTimeoutMs: 10000, inspectTimeoutMs: 5000
      } }
    ] }]));
    const workspace = parseYAML(await readFile(join(dir, 'pnpm-workspace.yaml'), 'utf8'));
    await writeFile(join(dir, 'pnpm-workspace.yaml'), JSON.stringify({ ...workspace,
      registry: origin + '/', storeDir: join(home, 'store'), cacheDir: join(home, 'cache'), stateDir: join(home, 'state'),
      ignoreScripts: true, fetchRetries: 0, fetchTimeout: 5000, updateNotifier: false }));
    return dir;
  }
  async function start(name) {
    const dir = join(home, 'profiles', name);
    const manifest = JSON.parse(await readFile(join(dir, 'package.json')));
    const loaded = loadProfileDirectory('studio-index-test', dir, join(runtime, 'package.json'));
    const resolution = await createRuntimeResolution({ installAnchor: join(runtime, 'package.json'), profile: loaded, home });
    const profile = { name, dir, home, cwd: home, startedBundles: manifest.dsh.profile.bundles,
      patchPath: join(dir, 'cordis.patch.yml'), installAnchor: join(runtime, 'package.json'), overlays: [], telemetryDisabledEnv: '1',
      packageManager: { command: pnpm, env: { XDG_CONFIG_HOME: join(home, 'config'), XDG_CACHE_HOME: join(home, 'cache'),
        npm_config_userconfig: join(home, 'empty.npmrc'), npm_config_globalconfig: join(home, 'empty.npmrc') } } };
    const ctx = await boot('studio-index-test', join(dir, 'cordis.yml'), readProfilePatches('studio-index-test', profile, loaded), async ctx => {
      ctx.provide('profileContext', profile);
      ctx.provide('appReady', { onReady: listener => { listener(); return () => {}; } });
      await ctx.plugin(PluginPackages, { resolution });
    });
    roots.add(ctx); assert.ok(ctx.pluginMarket); return ctx;
  }
  async function stop(ctx) { await ctx.fiber.dispose(); roots.delete(ctx); }
  const profileDir = await prepare('web'); await prepare('other-web');
  let ctx = await start('web');
  await ctx.pluginMarket.setIndexes([source]);
  const listing = await ctx.pluginMarket.search(source, query);
  assert.equal(listing.total, expected.packages.length);
  for (const pin of expected.packages) {
    const entry = listing.entries.find(entry => entry.name === pin.name);
    assert.equal(entry.defaultVersion, pin.version);
    assert.deepEqual(entry.versions[0].install, { spec: `${pin.name}@${pin.version}`, registry: expected.registry });
    assert.equal(entry.versions[0].compatibility.compatible, true);
    assert.equal(entry.installation.status, 'not-installed');
  }
  for (const text of ['费用', 'Cost Meter', '文件变更', 'File Review']) {
    assert.equal((await ctx.pluginMarket.search(source, { ...query, text })).total, 1, text);
  }
  assert.equal(hits.get('/index.json'), 1, 'successful index reads are cached');
  document = { ...document, plugins: document.plugins.slice(0, 1) };
  assert.equal((await ctx.pluginMarket.search(source, query)).total, 2);
  assert.equal((await ctx.pluginMarket.search(source, { ...query, refresh: true })).total, 1);
  assert.equal(hits.get('/index.json'), 2);
  await ctx.pluginMarket.setIndexes([source, origin + '/redirect', origin + '/invalid']);
  await assert.rejects(ctx.pluginMarket.search(origin + '/redirect', query), { code: 'plugin-market/fetch-failed' });
  await assert.rejects(ctx.pluginMarket.search(origin + '/invalid', query), { code: 'plugin-market/invalid-index' });
  await assert.rejects(ctx.pluginMarket.setIndexes([source, source]), { code: 'plugin-market/invalid-index-url' });
  await assert.rejects(ctx.pluginMarket.search(origin + '/not-configured', query), { code: 'plugin-market/unknown-index' });
  await ctx.pluginMarket.setIndexes([source]); await stop(ctx); ctx = await start('web');
  assert.equal(ctx.pluginMarket.listIndexes()[0].url, source, 'source persists after restart');
  const other = await start('other-web'); assert.deepEqual(other.pluginMarket.listIndexes(), []); await stop(other);
  t.diagnostic('Generated two-package index: bilingual search, exact targets, cache, refresh, errors, persistence and profile isolation passed');

  const fixtureSource = origin + '/fixture-index.json'; await ctx.pluginMarket.setIndexes([source, fixtureSource]);
  const entry = (await ctx.pluginMarket.search(fixtureSource, query)).entries[0];
  const target = entry.versions[0].install;
  const installed = await ctx.pluginManager.installBundle(target.spec, { registry: target.registry, saveExact: true, enabled: false });
  assert.equal(installed.error, undefined, JSON.stringify(installed));
  assert.equal(installed.packageResult.exitCode, 0);
  assert.ok(installed.packageResult.output.includes(join(home, 'store')), 'pnpm store stays inside test directory');
  assert.equal(JSON.parse(await readFile(join(profileDir, 'package.json'))).dependencies[fixtureName], '1.0.0');
  assert.equal(ctx.get('studioIndexFixture'), undefined, 'install does not silently enable code');
  await ctx.pluginManager.setBundleEnabled(fixtureName, true); await stop(ctx); ctx = await start('web');
  assert.equal(ctx.get('studioIndexFixture')?.active, true, 'official selected bundle activates after restart');
  await ctx.pluginManager.setBundleEnabled(fixtureName, false); await stop(ctx); ctx = await start('web');
  assert.equal(ctx.get('studioIndexFixture'), undefined);
  const removed = await ctx.pluginManager.removeBundle(fixtureName);
  assert.equal(removed.error, undefined, JSON.stringify(removed));
  assert.equal(JSON.parse(await readFile(join(profileDir, 'package.json'))).dependencies?.[fixtureName], undefined);
  assert.ok(hits.get('/fixture.tgz') > 0, 'real pnpm downloaded local bundle');
  await ctx.pluginMarket.setIndexes([]); await stop(ctx); ctx = await start('web');
  assert.deepEqual(ctx.pluginMarket.listIndexes(), [], 'deleted source stays deleted');
  t.diagnostic('Real local npm tarball: install, explicit enable, restart activation, disable and remove passed; third-party candidates were never executed');
});
