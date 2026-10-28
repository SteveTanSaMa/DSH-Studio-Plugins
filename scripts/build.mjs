import assert from 'node:assert/strict';
import { createHash, timingSafeEqual } from 'node:crypto';
import { mkdir, readFile, writeFile, rename, rm, mkdtemp } from 'node:fs/promises';
import { resolve, posix, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { t as listTar } from 'tar';
import semver from 'semver';
import { parseMarketIndex } from '@deepseek-ai/dsh-plugin-market-index';
import { evaluatePluginCompatibility } from '@deepseek-ai/dsh-app-boot';

export const root = fileURLToPath(new URL('../', import.meta.url));
export const indexURL = 'https://raw.githubusercontent.com/SteveTanSaMa/DSH-Studio-Plugins/main/public/index.json';
const maxPackageBytes = 32 * 1024 * 1024;
export function allowedURL(value, origin) {
  const url = new URL(value);
  assert.equal(url.protocol, 'https:', 'source must use HTTPS');
  assert.equal(url.origin, origin, 'unexpected registry or tarball host');
  assert.ok(!url.username && !url.password && !url.hash && !url.search, 'source carries credentials or extra URL components');
  return url;
}
export function verifyIntegrity(bytes, integrity) {
  assert.match(integrity, /^sha512-[A-Za-z0-9+/]{86}==$/, 'a pinned SHA-512 integrity is required');
  const expected = Buffer.from(integrity.slice(7), 'base64');
  const actual = createHash('sha512').update(bytes).digest();
  assert.ok(expected.length === actual.length && timingSafeEqual(expected, actual), 'tarball integrity mismatch');
}
export function validateSelection(config, withdrawn) {
  assert.equal(config.format, 1);
  assert.equal(semver.valid(config.runtimeVersion), config.runtimeVersion, 'exact Runtime version required');
  assert.equal(config.registry, 'https://registry.npmjs.org/');
  assert.ok(Array.isArray(config.packages), 'candidate list must be an array');
  assert.ok(Array.isArray(withdrawn.packages));
  const names = new Set();
  for (const entry of config.packages) {
    assert.match(entry.name, /^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/);
    assert.equal(semver.valid(entry.version), entry.version, 'exact plugin version required');
    assert.ok(!names.has(entry.name), 'duplicate candidate'); names.add(entry.name);
    assert.ok(!withdrawn.packages.some(item => item.name === entry.name && (!item.version || item.version === entry.version)), `withdrawn candidate: ${entry.name}`);
    assert.match(entry.integrity, /^sha512-[A-Za-z0-9+/]{86}==$/);
  }
}
async function download(url, limit) {
  const response = await fetch(url, { redirect: 'error', signal: AbortSignal.timeout(15000) });
  assert.equal(response.status, 200, `HTTP failure: ${response.status}`);
  assert.ok(Number(response.headers.get('content-length') || 0) <= limit, 'body too large');
  const chunks = []; let size = 0;
  for await (const chunk of response.body) {
    size += chunk.length;
    if (size > limit) { await response.body.cancel().catch(() => {}); throw new Error('body too large'); }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}
export async function inspectTarball(bytes) {
  const work = await mkdtemp(join(tmpdir(), 'studio-index-package-'));
  const entries = new Map(); let manifestBytes;
  try {
    const archive = join(work, 'package.tgz'); await writeFile(archive, bytes);
    let count = 0, expanded = 0;
    await listTar({ file: archive, strict: true, onReadEntry(entry) {
      assert.ok(++count <= 20000, 'too many tar entries');
      expanded += entry.size;
      assert.ok(expanded <= 128 * 1024 * 1024, 'expanded package too large');
      assert.ok(entry.path.startsWith('package/') && !entry.path.includes('\\') &&
        !entry.path.split('/').includes('..'), 'unsafe tar entry');
      assert.ok(['File', 'Directory'].includes(entry.type), 'links and special tar entries are not accepted');
      assert.ok(!entries.has(entry.path), 'duplicate tar entry');
      entries.set(entry.path, entry.type);
      if (entry.path === 'package/package.json') {
        assert.ok(entry.size <= 1024 * 1024, 'manifest too large');
        const chunks = []; entry.on('data', chunk => chunks.push(chunk));
        entry.on('end', () => { manifestBytes = Buffer.concat(chunks); });
      }
    } });
    assert.ok(manifestBytes, 'missing package.json');
    const manifest = JSON.parse(manifestBytes.toString('utf8'));
    const patch = manifest.dsh?.bundle?.patch;
    const patches = typeof patch === 'string' ? [patch] : patch;
    assert.ok(Array.isArray(patches) && patches.length > 0, 'missing bundle patch declaration');
    for (const file of patches) {
      assert.ok(typeof file === 'string' && file.length > 0 && !posix.isAbsolute(file) &&
        !file.includes('\\') && !file.split('/').includes('..'), 'unsafe bundle patch');
      assert.equal(entries.get('package/' + posix.normalize(file)), 'File', `missing bundle patch: ${file}`);
    }
    return { manifest, patches };
  } finally { await rm(work, { recursive: true, force: true }); }
}
export function buildIndex(plugins) {
  const index = {
    format: 1,
    title: { en: 'DSH Studio — Test candidates', zh: 'DSH Studio · 测试候选' },
    description: { en: 'Test index. Package checks do not establish functional compatibility.', zh: '测试索引。发布包核验不代表功能验证通过。' },
    metadata: {
      categories: {
        usage: { title: { en: 'Usage & costs', zh: '用量与费用' } },
        development: { title: { en: 'Development', zh: '开发工具' } }
      },
      labels: { candidate: { title: { en: 'Test candidate', zh: '测试候选' } } }
    }, plugins
  };
  parseMarketIndex(index, indexURL);
  return index;
}
export function matchingVerification(pin, runtimeVersion, records) {
  return records.filter(record => record.name === pin.name && record.version === pin.version &&
    record.integrity === pin.integrity && record.runtimeVersion === runtimeVersion);
}
export function candidateDescription(description, records) {
  const verified = records.some(record => record.platform === 'macos' && record.architecture === 'arm64' &&
    ['installation', 'webActivation', 'uninstall'].every(check => record.checks?.[check] === 'passed'));
  const suffix = verified
    ? { en: 'Installation, Web loading and removal checked on macOS arm64; full functional testing pending.',
        zh: '已在 macOS arm64 验证安装、Web 加载及卸载，完整功能待验收。' }
    : { en: 'Test candidate; installation, Web loading and removal have not all been verified for this version.',
        zh: '测试候选，尚未完成该版本的安装、Web 加载和卸载验证。' };
  assert.ok(description && typeof description.en === 'string' && typeof description.zh === 'string',
    'candidate descriptions require English and Chinese');
  return { en: `${description.en} ${suffix.en}`, zh: `${description.zh}${suffix.zh}` };
}
export async function build({ directory = root, fetchBytes = download } = {}) {
  const json = async path => JSON.parse(await readFile(join(directory, path), 'utf8'));
  const [config, curation, withdrawn] = await Promise.all([
    json('data/sources.json'), json('data/curation.json'), json('data/withdrawn.json')
  ]);
  validateSelection(config, withdrawn);
  const verification = await json('data/verification.json').catch(error => {
    if (error.code === 'ENOENT') return { schema: 1, records: [] };
    throw error;
  });
  assert.equal(verification.schema, 1); assert.ok(Array.isArray(verification.records));
  const plugins = [], packages = [];
  for (const pin of config.packages) {
    const metadataURL = new URL(encodeURIComponent(pin.name), config.registry);
    const metadata = JSON.parse((await fetchBytes(metadataURL, 16 * 1024 * 1024)).toString('utf8'));
    const release = metadata.versions?.[pin.version];
    assert.equal(release?.name, pin.name); assert.equal(release?.version, pin.version);
    assert.ok(!release.deprecated, 'deprecated package version');
    assert.equal(release.dist?.integrity, pin.integrity, 'registry integrity differs from reviewed pin');
    const tarballURL = allowedURL(release.dist.tarball, new URL(config.registry).origin);
    const bytes = await fetchBytes(tarballURL, maxPackageBytes);
    verifyIntegrity(bytes, pin.integrity);
    const { manifest, patches } = await inspectTarball(bytes);
    assert.equal(manifest.name, pin.name); assert.equal(manifest.version, pin.version);
    assert.equal(typeof manifest.engines?.dsh, 'string', 'prototype requires explicit upstream engines.dsh');
    assert.equal(evaluatePluginCompatibility(manifest, {}, config.runtimeVersion), undefined, 'candidate rejects target Harness');
    assert.ok(typeof manifest.license === 'string' && manifest.license.trim(), 'license declaration required');
    const published = metadata.time?.[pin.version];
    assert.ok(Number.isFinite(Date.parse(published)), 'missing publish timestamp');
    const copy = curation[pin.name]; assert.ok(copy, 'missing editorial description');
    const checks = matchingVerification(pin, config.runtimeVersion, verification.records);
    plugins.push({ name: pin.name, title: copy.title, description: candidateDescription(copy.description, checks),
      metadata: { category: copy.category, labels: ['candidate'] },
      versions: [{ version: pin.version, publishTimestamp: Math.floor(Date.parse(published) / 1000),
        source: { type: 'npm', registry: config.registry }, engines: { dsh: manifest.engines.dsh } }]
    });
    packages.push({ name: pin.name, version: pin.version, integrity: pin.integrity,
      tarball: tarballURL.href, bytes: bytes.length, license: manifest.license, patches,
      engines: manifest.engines, publishedAt: published, packageCheck: 'passed',
      functionalTest: checks.length ? 'partial' : 'not-run', ...(checks.length ? { verification: checks } : {}) });
  }
  const index = buildIndex(plugins);
  const evidence = { schema: 1, checkedAt: new Date().toISOString(), runtimeVersion: config.runtimeVersion,
    node: process.version, validatorVersion: '0.2.1-rc.2', packages };
  // Build a complete generation first; replace the output directory only after every check passes.
  const stage = join(directory, '.index-stage'); const output = join(directory, 'public');
  const backup = join(directory, '.index-backup');
  await rm(stage, { recursive: true, force: true }); await mkdir(stage);
  await writeFile(join(stage, 'index.json'), JSON.stringify(index, null, 2) + '\n');
  await writeFile(join(stage, 'status.json'), JSON.stringify(evidence, null, 2) + '\n');
  await rm(backup, { recursive: true, force: true });
  let hadOutput = false;
  try { await rename(output, backup); hadOutput = true; } catch (error) { if (error.code !== 'ENOENT') throw error; }
  try { await rename(stage, output); } catch (error) { if (hadOutput) await rename(backup, output); throw error; }
  await rm(backup, { recursive: true, force: true });
  return evidence;
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = await build();
  console.log(`Validated ${result.packages.length} pinned packages; wrote public/index.json and public/status.json`);
}
