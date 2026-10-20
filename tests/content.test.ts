import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { extractArticle, toBlocks } from '../src/content.ts';
import { safeUrl } from '../src/shared.ts';

const doc = (html: string) =>
  new JSDOM(html, { url: 'https://example.com/articles/one' }).window.document;
test(
  'preserves ordered content, inline formatting, links and ' + 'images without executable URLs',
  () => {
    const blocks = toBlocks(
      doc(
        [
          '<article><h2>Heading</h2><p>A <strong>bold</strong> ',
          '<a href="/two">link</a> <a href="javascript:alert(1)">unsafe</a>.</p>',
          '<ul><li>First<ul><li>Nested</li></ul></li></ul>',
          '<pre>const x = 1;\nconsole.log(x)</pre>',
          '<img src="/image.jpg" alt="A view"><script>danger()</script>',
          '<p hidden>secret</p></article>',
        ].join(''),
      ).querySelector('article')!,
      'https://example.com',
    );
    assert.deepEqual(
      blocks.map((b) => b.type),
      ['heading_2', 'paragraph', 'bulleted_list_item', 'bulleted_list_item', 'code', 'image'],
    );
    assert.ok(JSON.stringify(blocks).includes('https://example.com/two'));
    assert.ok(JSON.stringify(blocks).includes('"bold":true'));
    assert.ok(!JSON.stringify(blocks).includes('javascript:'));
    assert.ok(!JSON.stringify(blocks).includes('danger()'));
    assert.ok(!JSON.stringify(blocks).includes('secret'));
  },
);
test('splits long paragraphs and code into valid Notion rich text lengths', () => {
  const blocks = toBlocks(
    doc(`<p>${'😀'.repeat(2500)}</p><pre>${'x'.repeat(5000)}</pre>`).body,
    'https://example.com',
  );
  for (const block of blocks)
    for (const rich of block[block.type].rich_text ?? []) {
      assert.ok(rich.text.content.length <= 2000);
      assert.ok(!/^[\uDC00-\uDFFF]|[\uD800-\uDBFF]$/.test(rich.text.content));
    }
});
test('article extraction does not mutate the original page or ' + 'include navigation', () => {
  const document = doc(
    `<title>Useful article</title><nav>Menu</nav><article><h1>Useful article</h1>${(
      '<p>This is a useful article with enough meaningful sentences ' +
      'to be identified as readable content. It explains a topic in ' +
      'detail, with examples and references.</p>'
    ).repeat(8)}</article>`,
  );
  const before = document.documentElement.outerHTML;
  const result = extractArticle(document);
  assert.equal(result.title, 'Useful article');
  assert.ok(result.blocks.length >= 8);
  assert.equal(before, document.documentElement.outerHTML);
  assert.ok(!JSON.stringify(result.blocks).includes('Menu'));
});
test('rejects non-web URLs and signals pages without extractable content', () => {
  assert.equal(safeUrl('file:///etc/passwd'), undefined);
  assert.equal(safeUrl('data:text/html,hello'), undefined);
  assert.equal(extractArticle(doc('<title>Empty page</title>')).blocks.length, 0);
});
