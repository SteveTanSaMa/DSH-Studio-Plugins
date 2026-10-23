import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { parseMarketIndex, marketInstallTarget } from '@deepseek-ai/dsh-plugin-market-index';
import { root, indexURL, validateSelection } from './build.mjs';
const json = async path => JSON.parse(await readFile(join(root, path), 'utf8'));
const [config, withdrawn, document, status] = await Promise.all([
  json('data/sources.json'), json('data/withdrawn.json'), json('public/index.json'), json('public/status.json')
]);
validateSelection(config, withdrawn);
const index = parseMarketIndex(document, indexURL);
assert.equal(index.plugins.length, config.packages.length);
for (const pin of config.packages) {
  const plugin = index.plugins.find(plugin => plugin.name === pin.name);
  assert.ok(plugin); assert.equal(plugin.versions.length, 1);
  const version = plugin.versions[0]; assert.equal(version.version, pin.version);
  assert.deepEqual(marketInstallTarget(pin.name, version), { spec: `${pin.name}@${pin.version}`, registry: config.registry });
  assert.equal(status.packages.find(item => item.name === pin.name)?.integrity, pin.integrity);
}
console.log(`Official format and exact install targets valid: ${index.plugins.length} plugins`);
