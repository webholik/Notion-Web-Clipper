import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readLocalData, writeLocalData } from '../src/storage.ts';
import type { LocalData } from '../src/model.ts';

const saved: LocalData = {
  connections: [{ id: 'personal', name: 'Personal', token: 'ntn_fixture_token' }],
  jobs: [],
  recent: {},
  activeConnectionId: 'personal',
};

function storage(initial: Record<string, unknown> = {}) {
  const values = structuredClone(initial);
  return {
    get: async (key: string) => ({ [key]: values[key] }),

    set: async (record: Record<string, unknown>) => {
      Object.assign(values, structuredClone(record));
    },
  };
}

test('new and returning connections load without a passphrase', async () => {
  const local = storage();
  assert.deepEqual((await readLocalData(local)).connections, []);
  await writeLocalData(local, saved);
  assert.deepEqual(await readLocalData(local), saved);
});

test('rejects unsupported storage versions without overwriting saved data', async () => {
  const local = storage({ clipperData: { version: 99, data: saved } });
  await assert.rejects(readLocalData(local), /newer clipper version/);
  assert.deepEqual((await local.get('clipperData')).clipperData, { version: 99, data: saved });
});

test('rejects malformed saved data instead of silently replacing it', async () => {
  const local = storage({ clipperData: { version: 2, data: { connections: 'invalid' } } });
  await assert.rejects(readLocalData(local), /invalid/);
});
