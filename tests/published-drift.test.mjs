import assert from 'node:assert/strict';
import test from 'node:test';
import { compareGenerated } from '../scripts/check-generated.mjs';

const publication = () => ({
  index: { format: 1, plugins: [{ name: 'example', description: { en: 'Example', zh: '示例' },
    versions: [{ version: '1.0.0', engines: { dsh: '>=0.2.1' } }] }] },
  status: { checkedAt: '2026-10-23T00:00:00Z', node: 'v26.12.1',
    packages: [{ name: 'example', version: '1.0.0', integrity: 'sha512-example', functionalTest: 'partial' }] }
});
test('build timestamps can differ without reporting published drift', () => {
  const committed = publication(); const generated = structuredClone(committed);
  generated.status.checkedAt = '2026-10-28T00:00:00Z';
  assert.doesNotThrow(() => compareGenerated(committed, generated));
});
test('stale published entries, versions, descriptions and compatibility fail', () => {
  const mutations = [
    index => { index.plugins = []; },
    index => { index.plugins[0].versions[0].version = '2.0.0'; },
    index => { index.plugins[0].description.zh = '更新'; },
    index => { index.plugins[0].versions[0].engines.dsh = '>=99.0.0'; }
  ];
  for (const mutate of mutations) {
    const committed = publication(); const generated = structuredClone(committed);
    mutate(generated.index);
    assert.throws(() => compareGenerated(committed, generated), /public\/index\.json/);
  }
});
test('stale package integrity or validation evidence fails even if index matches', () => {
  for (const field of ['integrity', 'functionalTest']) {
    const committed = publication(); const generated = structuredClone(committed);
    generated.status.packages[0][field] = 'changed';
    assert.throws(() => compareGenerated(committed, generated), /public\/status\.json/);
  }
});

test('missing or invalid publication timestamp is rejected', () => {
  for (const value of [undefined, 'not-a-date']) {
    const committed = publication(); committed.status.checkedAt = value;
    assert.throws(() => compareGenerated(committed, publication()), /valid timestamp/);
  }
});
