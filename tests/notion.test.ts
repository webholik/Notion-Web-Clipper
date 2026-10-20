import { test } from 'node:test';
import assert from 'node:assert/strict';
import { NotionClient, NotionError } from '../src/notion.ts';
const id = '12345678-1234-1234-1234-123456789abc';
test('calls the default browser fetch with its global receiver', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async function () {
    assert.equal(this, globalThis, 'Firefox fetch must be called with its browser global');
    return Response.json({ object: 'user', id, name: 'Personal' });
  };
  try {
    assert.equal(await new NotionClient('test-token').verify(), 'Personal');
  } finally {
    globalThis.fetch = originalFetch;
  }
});
test('search paginates and uses data source title and URL property IDs', async () => {
  const bodies: any[] = [];
  const client = new NotionClient('test-token', async (_url, options) => {
    bodies.push(JSON.parse(String(options?.body)));
    return Response.json(
      bodies.length === 1
        ? {
            results: [
              {
                object: 'data_source',
                id,
                title: [{ plain_text: 'Reading' }],
                properties: {
                  Name: { id: 'title', type: 'title' },
                  Link: { id: 'url-id', type: 'url' },
                },
              },
            ],
            has_more: true,
            next_cursor: 'next',
          }
        : { results: [], has_more: false, next_cursor: null },
    );
  });
  const result = await client.search('Reading');
  assert.deepEqual(result.items[0], {
    id,
    name: 'Reading',
    kind: 'data_source',
    titleProperty: 'title',
    urlProperty: 'url-id',
  });
  assert.equal(result.cursor, 'next');
  await client.search('Reading', result.cursor);
  assert.equal(bodies[1].start_cursor, 'next');
});
test(
  'creates a database page using its actual schema without ' + 'changing the database',
  async () => {
    let body: any;
    const client = new NotionClient('secret', async (_url, options) => {
      if (options?.method === 'GET')
        return Response.json({
          properties: { Name: { id: 'abc', type: 'title' }, URL: { id: 'url', type: 'url' } },
        });
      body = JSON.parse(String(options?.body));
      return Response.json({ id, url: `https://www.notion.so/${id}` });
    });
    await client.createPage(
      { id, kind: 'data_source', name: 'Reading', titleProperty: 'abc', urlProperty: 'url' },
      'Title',
      'https://example.com',
    );
    assert.deepEqual(body.parent, { type: 'data_source_id', data_source_id: id });
    assert.equal(body.properties.abc.title[0].text.content, 'Title');
    assert.equal(body.properties.url.url, 'https://example.com');
    assert.equal(body.children.length, 1);
  },
);
test(
  'does not retry rate limits or ambiguous writes and returns ' + 'safe actionable errors',
  async () => {
    let count = 0;
    const client = new NotionClient('secret', async () => {
      count++;
      return Response.json(
        { message: 'secret internal details' },
        { status: 429, headers: { 'Retry-After': '12' } },
      );
    });
    await assert.rejects(
      client.search(''),
      (e: unknown) =>
        e instanceof NotionError && e.retryAfter === 12 && !e.message.includes('internal details'),
    );
    assert.equal(count, 1);
  },
);
