import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// checkedAt describes this build rather than the package contents. Every other
// published field, including verification evidence and Node version, must match.
export function compareGenerated(committed, generated) {
  assert.deepStrictEqual(committed.index, generated.index,
    'committed public/index.json differs from the generated index');
  for (const item of [committed.status, generated.status]) {
    assert.ok(typeof item.checkedAt === 'string' && Number.isFinite(Date.parse(item.checkedAt)), 'status checkedAt must be a valid timestamp');
  }
  const { checkedAt: _previous, ...committedStatus } = committed.status;
  const { checkedAt: _current, ...generatedStatus } = generated.status;
  assert.deepStrictEqual(committedStatus, generatedStatus,
    'committed public/status.json differs from generated package evidence');
}
async function readDirectory(directory) {
  const [index, status] = await Promise.all(['index.json', 'status.json'].map(async file =>
    JSON.parse(await readFile(join(directory, file), 'utf8'))));
  return { index, status };
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [committed, generated] = process.argv.slice(2);
  assert.ok(committed && generated, 'usage: node scripts/check-generated.mjs COMMITTED_DIR GENERATED_DIR');
  compareGenerated(await readDirectory(committed), await readDirectory(generated));
  console.log('Committed Raw index and evidence match the generated output');
}
