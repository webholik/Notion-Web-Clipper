import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createLocalServer } from '../scripts/local-server.mjs';

async function start(upstreamFetch) {
  const server = createLocalServer({ upstreamFetch });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const script = await (await fetch(origin + '/preview.js')).text();
  const key = script.match(/const bridgeKey = "([A-Za-z0-9_-]+)"/)[1];
  return {
    server,
    origin,
    headers: {
      'X-Pocket-Bridge': key,
      Origin: origin,
      Authorization: 'Bearer ntn_fixture_token_for_testing_only',
      'Content-Type': 'application/json',
      'Notion-Version': '2026-03-11',
    },
  };
}
test(
  'forwards an authorized database query to the fixed Notion ' +
    'origin without substituting sample results',
  async () => {
    const calls = [];
    const { server, origin, headers } = await start(async (url, options) => {
      calls.push({ url, options });
      return Response.json({
        results: [{ object: 'data_source', id: 'notes', title: [{ plain_text: 'Notes' }] }],
        has_more: false,
      });
    });
    try {
      const response = await fetch(origin + '/api/notion/v1/search', {
        method: 'POST',
        headers,
        body: JSON.stringify({ query: 'notes' }),
      });
      assert.equal(response.status, 200);
      assert.equal((await response.json()).results[0].title[0].plain_text, 'Notes');
      assert.equal(calls[0].url, 'https://api.notion.com/v1/search');
      assert.equal(JSON.parse(calls[0].options.body).query, 'notes');
      assert.equal(calls[0].options.redirect, 'error');
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  },
);
test(
  'rejects foreign origins, missing bridge keys, unsafe paths ' +
    'and oversized payloads before forwarding',
  async () => {
    let calls = 0;
    const { server, origin, headers } = await start(async () => {
      calls++;
      return Response.json({});
    });
    try {
      for (const badHeaders of [
        { ...headers, Origin: 'https://untrusted.example' },
        { ...headers, 'X-Pocket-Bridge': '' },
      ]) {
        assert.equal(
          (
            await fetch(origin + '/api/notion/v1/search', {
              method: 'POST',
              headers: badHeaders,
              body: '{}',
            })
          ).status,
          403,
        );
      }
      assert.equal(
        (
          await fetch(origin + '/api/notion/v1/oauth/token', {
            method: 'POST',
            headers,
            body: '{}',
          })
        ).status,
        404,
      );
      assert.equal(
        (
          await fetch(origin + '/api/notion/v1/search', {
            method: 'POST',
            headers,
            body: 'x'.repeat(600_000),
          })
        ).status,
        413,
      );
      assert.equal(calls, 0);
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  },
);
test('preserves Notion authentication errors and rate limit headers', async () => {
  const { server, origin, headers } = await start(async () =>
    Response.json(
      { object: 'error', code: 'rate_limited' },
      { status: 429, headers: { 'Retry-After': '10' } },
    ),
  );
  try {
    const response = await fetch(origin + '/api/notion/v1/search', {
      method: 'POST',
      headers,
      body: '{}',
    });
    assert.equal(response.status, 429);
    assert.equal(response.headers.get('Retry-After'), '10');
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
