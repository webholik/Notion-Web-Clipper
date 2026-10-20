import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runJob, attachPage, fingerprint } from '../src/jobs.ts';
import { sourceBlock, NotionError } from '../src/notion.ts';
import { richText } from '../src/shared.ts';
import type { ContentBlock, Job } from '../src/model.ts';
function textBlock(type: string, text: string): ContentBlock {
  return { object: 'block', type, [type]: { rich_text: richText(text) } };
}

const destinationId = '12345678-1234-1234-1234-123456789abc';
const pageId = 'aaaaaaaa-1234-1234-1234-123456789abc';
function job(): Job {
  return {
    id: 'job',
    connectionId: 'one',
    title: 'Article',
    source: 'https://example.com',
    destination: { id: destinationId, kind: 'page', name: 'Reading', titleProperty: 'title' },
    blocks: Array.from({ length: 95 }, (_, i) => textBlock('paragraph', `Paragraph ${i}`)),
    next: 0,
    status: 'queued',
    createdAt: new Date().toISOString(),
  };
}
test('persists intent before writes and completes content in bounded batches', async () => {
  const current = job();
  const snapshots: Job[] = [];
  const written: ContentBlock[] = [];
  await runJob(
    current,
    {
      createPage: async () => {
        assert.equal(snapshots.at(-1)?.status, 'creating');
        return { id: pageId, url: 'https://www.notion.so/' + pageId };
      },

      append: async (_id, blocks) => {
        assert.ok(snapshots.at(-1)?.inFlight);
        assert.ok(blocks.length <= 40);
        written.push(...blocks);
      },

      children: async () => [sourceBlock(current.source)],
    },
    async () => {
      snapshots.push(structuredClone(current));
    },
  );
  assert.equal(current.status, 'done');
  assert.equal(current.next, 95);
  assert.equal(written.length, 95);
});
test('never automatically recreates a page after an ambiguous create timeout', async () => {
  const current = job();
  let creates = 0;
  const client = {
    createPage: async () => {
      creates++;
      throw new NotionError('Connection interrupted.');
    },

    append: async () => {},

    children: async () => [],
  };
  await runJob(current, client, async () => {});
  assert.equal(current.status, 'uncertain');
  await runJob(current, client, async () => {});
  assert.equal(creates, 1);
});
test(
  'reconciles an append that succeeded before the connection ' +
    'dropped without duplicating content',
  async () => {
    const current = job();
    current.pageId = pageId;
    current.pageUrl = 'https://www.notion.so/' + pageId;
    current.status = 'writing';
    current.inFlight = { start: 0, count: 40 };
    const written: ContentBlock[] = [];
    await runJob(
      current,
      {
        createPage: async () => {
          throw new Error('must not create');
        },

        children: async () => [sourceBlock(current.source), ...current.blocks.slice(0, 40)],

        append: async (_id, blocks) => {
          written.push(...blocks);
        },
      },
      async () => {},
    );
    assert.equal(current.status, 'done');
    assert.equal(written.length, 55);
    assert.equal(fingerprint(written[0]), fingerprint(current.blocks[40]));
  },
);
test('refuses to resume if saved page content was edited or is inconsistent', async () => {
  const current = job();
  current.pageId = pageId;
  current.status = 'paused';
  let writes = 0;
  await runJob(
    current,
    {
      createPage: async () => {
        throw new Error();
      },

      children: async () => [
        sourceBlock(current.source),
        textBlock('paragraph', 'Unexpected edit'),
      ],

      append: async () => {
        writes++;
      },
    },
    async () => {},
  );
  assert.equal(current.status, 'paused');
  assert.match(current.error!, /changed|match/i);
  assert.equal(writes, 0);
});
test('allows safe retry after explicit rejection but not after a ' + 'server error', async () => {
  const current = job();
  await runJob(
    current,
    {
      createPage: async () => {
        throw new NotionError('Rate limited', 429);
      },

      children: async () => [],

      append: async () => {},
    },
    async () => {},
  );
  assert.equal(current.status, 'paused');
});
test('an existing page can only be attached if parent and content match', async () => {
  const current = job();
  current.status = 'uncertain';
  await assert.rejects(
    attachPage(current, pageId, {
      pageParent: async () => ({ kind: 'page_id', id: 'bbbbbbbb-1234-1234-1234-123456789abc' }),

      children: async () => [sourceBlock(current.source)],
    }),
    /destination/i,
  );
  assert.equal(current.pageId, undefined);
});
