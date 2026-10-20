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

test('keeps five title-and-link summaries while preserving unfinished captures', async () => {
  const completed = Array.from({ length: 7 }, (_, i) => ({
    id: `saved-${i}`,
    status: 'done' as const,
    title: `Article ${i}`,
    source: `https://example.com/${i}`,
    pageUrl: `https://www.notion.so/${i}`,
    connectionId: 'personal',
    destination: {
      id: 'destination',
      kind: 'page' as const,
      name: 'Reading',
      titleProperty: 'title',
    },
    blocks: [
      { object: 'block' as const, type: 'paragraph', paragraph: { text: 'private content' } },
    ],
    next: 1,
    createdAt: new Date().toISOString(),
  }));
  const pending = { ...completed[0], id: 'pending', status: 'paused' as const };
  const local = storage({
    clipperData: { version: 2, data: { ...saved, jobs: [pending, ...completed] } },
  });
  const loaded = await readLocalData(local);
  assert.deepEqual(loaded.jobs[0], pending);
  assert.deepEqual(
    loaded.jobs.slice(1),
    completed.slice(0, 5).map((clip) => ({
      id: clip.id,
      status: 'done',
      title: clip.title,
      source: clip.source,
      pageUrl: clip.pageUrl,
    })),
  );
  assert.deepEqual((await local.get('clipperData')).clipperData, { version: 2, data: loaded });
  await writeLocalData(local, { ...saved, jobs: completed });
  const reopened = await readLocalData(local);
  assert.equal(reopened.jobs.length, 5);
  assert.ok(reopened.jobs.every((clip) => !('blocks' in clip)));
});
