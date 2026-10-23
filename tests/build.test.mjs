import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { c as createTar } from 'tar';
import test from 'node:test';
import { build, allowedURL, verifyIntegrity } from '../scripts/build.mjs';

async function fixture(t) {
  const dir = await mkdtemp(join(tmpdir(), 'studio-index-build-test-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  await mkdir(join(dir, 'package')); await mkdir(join(dir, 'data'));
  const manifest = { name: 'studio-index-fixture', version: '1.0.0', license: 'MIT',
    engines: { dsh: '>=0.2.1-0 <0.3.0-0' }, dsh: { bundle: { patch: 'cordis.patch.yml' } } };
  await writeFile(join(dir, 'package/package.json'), JSON.stringify(manifest));
  await writeFile(join(dir, 'package/cordis.patch.yml'), '[]\n');
  await createTar({ cwd: dir, gzip: true, file: join(dir, 'package.tgz') }, ['package']);
  const bytes = await readFile(join(dir, 'package.tgz'));
  const integrity = 'sha512-' + createHash('sha512').update(bytes).digest('base64');
  const config = { format: 1, runtimeVersion: '0.2.1-rc.2', registry: 'https://registry.npmjs.org/',
    packages: [{ name: manifest.name, version: manifest.version, integrity }] };
  const metadata = { versions: { '1.0.0': { ...manifest, dist: { integrity, tarball: 'https://registry.npmjs.org/fixture.tgz' } } },
    time: { '1.0.0': '2026-10-01T00:00:00.000Z' } };
  await writeFile(join(dir, 'data/sources.json'), JSON.stringify(config));
  await writeFile(join(dir, 'data/curation.json'), JSON.stringify({ [manifest.name]: {
    title: { en: 'Fixture', zh: '测试插件' }, description: { en: 'Candidate', zh: '测试候选' }, category: 'usage' } }));
  await writeFile(join(dir, 'data/withdrawn.json'), '{"packages":[]}');
  const fetchBytes = async url => url.pathname.endsWith('.tgz') ? bytes : Buffer.from(JSON.stringify(metadata));
  return { dir, bytes, integrity, config, metadata, fetchBytes };
}
test('build retains exact package identity, compatibility and check evidence', async t => {
  const f = await fixture(t); await build({ directory: f.dir, fetchBytes: f.fetchBytes });
  const index = JSON.parse(await readFile(join(f.dir, 'public/index.json')));
  assert.equal(index.plugins[0].versions[0].version, '1.0.0');
  assert.equal(index.plugins[0].versions[0].engines.dsh, '>=0.2.1-0 <0.3.0-0');
  const status = JSON.parse(await readFile(join(f.dir, 'public/status.json')));
  assert.equal(status.packages[0].functionalTest, 'not-run');
  assert.equal(status.packages[0].integrity, f.integrity);
});
test('registry failure and integrity mismatch preserve the whole previous generation', async t => {
  const f = await fixture(t); await build({ directory: f.dir, fetchBytes: f.fetchBytes });
  const before = await readFile(join(f.dir, 'public/index.json'));
  const statusBefore = await readFile(join(f.dir, 'public/status.json'));
  await assert.rejects(build({ directory: f.dir, fetchBytes: async () => { throw new Error('offline'); } }), /offline/);
  await assert.rejects(build({ directory: f.dir, fetchBytes: async url => url.pathname.endsWith('.tgz') ? Buffer.from('corrupt') : f.fetchBytes(url) }), /integrity mismatch/);
  assert.deepEqual(await readFile(join(f.dir, 'public/index.json')), before);
  assert.deepEqual(await readFile(join(f.dir, 'public/status.json')), statusBefore);
});
test('withdrawn candidate prevents any fetch or automatic resurrection', async t => {
  const f = await fixture(t);
  await writeFile(join(f.dir, 'data/withdrawn.json'), JSON.stringify({ packages: [{ name: 'studio-index-fixture', reason: 'test withdrawal' }] }));
  await assert.rejects(build({ directory: f.dir, fetchBytes: async () => assert.fail('must not fetch withdrawn package') }), /withdrawn candidate/);
});
test('floating versions and duplicate packages are rejected', async t => {
  const f = await fixture(t); f.config.packages[0].version = 'latest';
  await writeFile(join(f.dir, 'data/sources.json'), JSON.stringify(f.config));
  await assert.rejects(build({ directory: f.dir, fetchBytes: f.fetchBytes }), /exact plugin version/);
  f.config.packages[0].version = '1.0.0'; f.config.packages.push({ ...f.config.packages[0] });
  await writeFile(join(f.dir, 'data/sources.json'), JSON.stringify(f.config));
  await assert.rejects(build({ directory: f.dir, fetchBytes: f.fetchBytes }), /duplicate candidate/);
});
test('tarballs must come from reviewed HTTPS registry and match SHA-512', () => {
  for (const url of ['http://registry.npmjs.org/a.tgz', 'https://evil.example/a.tgz', 'https://user:password@registry.npmjs.org/a.tgz']) {
    assert.throws(() => allowedURL(url, 'https://registry.npmjs.org'));
  }
  assert.throws(() => verifyIntegrity(Buffer.from('x'), 'sha512-' + 'A'.repeat(86) + '=='), /integrity mismatch/);
});
