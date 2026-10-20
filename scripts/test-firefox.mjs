// Run the actual extension in an isolated Firefox profile. All Notion responses
// are local fixtures; no tokens or requests are sent to a live workspace.
import { cmd } from 'web-ext';
import { cp, mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createServer } from 'node:http';
import assert from 'node:assert/strict';

const directory = await mkdtemp(join(tmpdir(), 'pocket-firefox-'));
let runner;
let finish;
const result = new Promise((resolve) => {
  finish = resolve;
});
const server = createServer(async (req, res) => {
  if (req.url === '/result') {
    let body = '';
    for await (const chunk of req) body += chunk;
    finish(JSON.parse(body));
    res.end('ok');
    return;
  }
  res.setHeader('Content-Type', 'text/html');
  res.end(
    `<title>Real Firefox article</title><article><h1>Real Firefox article</h1>${(
      '<p>A meaningful article about reading and collecting ideas. ' +
      'This page has enough readable content to exercise Mozilla’s ' +
      'article parser in a real Firefox tab. It contains a long ' +
      'discussion with useful examples and context.</p>'
    ).repeat(10)}</article>`,
  );
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
try {
  await cp('dist', directory, { recursive: true });
  const manifest = JSON.parse(await readFile(join(directory, 'manifest.json')));
  manifest.host_permissions = ['https://api.notion.com/*', 'http://127.0.0.1/*'];
  manifest.background.scripts.unshift('test-background.js');
  manifest.content_security_policy.extension_pages =
    manifest.content_security_policy.extension_pages.replace(
      'connect-src https://api.notion.com',
      `connect-src https://api.notion.com ${origin}`,
    );
  await writeFile(join(directory, 'manifest.json'), JSON.stringify(manifest));
  const html = await readFile(join(directory, 'options.html'), 'utf8');
  await writeFile(
    join(directory, 'options.html'),
    html.replace('</body>', '<script src="test-driver.js"></script></body>'),
  );
  const fixture = await readFile('scripts/preview-browser.js', 'utf8');
  // Reuse only the fake HTTP implementation, never the fake browser APIs.
  const fakeHttp = fixture
    .slice(fixture.indexOf('const fixtureId'), fixture.indexOf('window.browser ='))
    .replaceAll('window.', 'globalThis.')
    .replace(
      'const nativeFetch = globalThis.fetch;',
      'const nativeFetch = globalThis.fetch.bind(globalThis);',
    );
  const openSettings = "browser.tabs.create({ url: browser.runtime.getURL('options.html') })";
  await writeFile(
    join(directory, 'test-background.js'),
    fakeHttp + `\nsetTimeout(() => ${openSettings}, 500);`,
  );
  const driver = await readFile('tests/firefox/driver.js', 'utf8');
  await writeFile(
    join(directory, 'test-driver.js'),
    `const origin = ${JSON.stringify(origin)};\n${driver}`,
  );
  runner = await cmd.run({
    sourceDir: directory,
    artifactsDir: resolve('artifacts'),
    firefox: process.env.FIREFOX_BINARY || '/Applications/Firefox.app/Contents/MacOS/firefox',
    args: ['-headless'],
    noInput: true,
    noReload: true,
  });
  const timeout = setTimeout(() => finish({ ok: false, error: 'Firefox test timed out' }), 30_000);
  const outcome = await result;
  clearTimeout(timeout);
  assert.equal(outcome.ok, true, JSON.stringify(outcome));
  console.log(`Firefox extension integration: ${outcome.checks.length} checks passed`);
  outcome.checks.forEach((check) => console.log('  ✓ ' + check));
} finally {
  if (runner) await runner.exit();
  await new Promise((resolve) => server.close(resolve));
  await rm(directory, { recursive: true, force: true });
}
