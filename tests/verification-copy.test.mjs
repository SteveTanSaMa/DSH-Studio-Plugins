import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { c as createTar } from 'tar';
import { build, candidateDescription, matchingVerification } from '../scripts/build.mjs';

const pin = { name: 'sample', version: '1.0.0', integrity: 'sha512-reviewed' };
const runtime = '0.2.1-rc.2';
const description = { en: 'Sample plugin.', zh: '示例插件。' };
const verified = { ...pin, runtimeVersion: runtime, platform: 'macos', architecture: 'arm64',
  checks: { installation: 'passed', webActivation: 'passed', uninstall: 'passed' } };
const rendered = (candidate, version, records) => candidateDescription(description, matchingVerification(candidate, version, records));

test('verified claim requires the exact version, integrity and Harness', () => {
  assert.match(rendered(pin, runtime, [verified]).zh, /已在 macOS arm64 验证/);
  for (const candidate of [{ ...pin, version: '1.0.1' }, { ...pin, integrity: 'sha512-other' }, { ...pin, name: 'other' }]) {
    assert.doesNotMatch(rendered(candidate, runtime, [verified]).zh, /已在 macOS arm64 验证/);
  }
  assert.doesNotMatch(rendered(pin, '0.2.1-rc.3', [verified]).zh, /已在 macOS arm64 验证/);
});

test('all three checks must pass in one matching macOS arm64 record', () => {
  for (const record of [
    { ...verified, platform: 'linux' }, { ...verified, architecture: 'x64' },
    { ...verified, checks: { ...verified.checks, uninstall: 'failed' } },
    { ...verified, checks: { installation: 'passed' } },
  ]) assert.match(rendered(pin, runtime, [record]).zh, /尚未完成/);
  assert.match(rendered(pin, runtime, [
    { ...verified, checks: { installation: 'passed' } },
    { ...verified, checks: { webActivation: 'passed', uninstall: 'passed' } },
  ]).zh, /尚未完成/);
});

test('building a newer version does not carry the old release verification claim', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'studio-verification-copy-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  await mkdir(join(dir, 'package')); await mkdir(join(dir, 'data'));
  const manifest = { name: 'sample', version: '1.0.1', license: 'MIT',
    engines: { dsh: '>=0.2.1-0 <0.3.0-0' }, dsh: { bundle: { patch: 'cordis.patch.yml' } } };
  await writeFile(join(dir, 'package/package.json'), JSON.stringify(manifest));
  await writeFile(join(dir, 'package/cordis.patch.yml'), '[]\n');
  await createTar({ cwd: dir, gzip: true, file: join(dir, 'package.tgz') }, ['package']);
  const bytes = await readFile(join(dir, 'package.tgz'));
  const integrity = 'sha512-' + createHash('sha512').update(bytes).digest('base64');
  const candidate = { name: manifest.name, version: manifest.version, integrity };
  const config = { format: 1, runtimeVersion: runtime, registry: 'https://registry.npmjs.org/', packages: [candidate] };
  const metadata = { versions: { [candidate.version]: { ...manifest, dist: { integrity, tarball: 'https://registry.npmjs.org/sample.tgz' } } },
    time: { [candidate.version]: '2026-10-01T00:00:00.000Z' } };
  for (const [name, value] of [
    ['sources', config], ['curation', { sample: { title: 'Sample', description, category: 'usage' } }],
    ['withdrawn', { packages: [] }], ['verification', { schema: 1, records: [verified] }],
  ]) await writeFile(join(dir, `data/${name}.json`), JSON.stringify(value));
  await build({ directory: dir, fetchBytes: async url => url.pathname.endsWith('.tgz') ? bytes : Buffer.from(JSON.stringify(metadata)) });
  const index = JSON.parse(await readFile(join(dir, 'public/index.json'), 'utf8'));
  assert.match(index.plugins[0].description.zh, /尚未完成/);
  assert.doesNotMatch(index.plugins[0].description.zh, /已在 macOS arm64 验证/);
  const status = JSON.parse(await readFile(join(dir, 'public/status.json'), 'utf8'));
  assert.equal(status.packages[0].functionalTest, 'not-run');
});
