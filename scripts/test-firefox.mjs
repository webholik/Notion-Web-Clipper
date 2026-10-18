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
const result = new Promise(resolve => { finish = resolve; });
const server = createServer(async (req, res) => {
  if (req.url === '/result') {
    let body = ''; for await (const chunk of req) body += chunk;
    finish(JSON.parse(body)); res.end('ok'); return;
  }
  res.setHeader('Content-Type', 'text/html');
  res.end(`<title>Real Firefox article</title><article><h1>Real Firefox article</h1>${'<p>A meaningful article about reading and collecting ideas. This page has enough readable content to exercise Mozilla’s article parser in a real Firefox tab. It contains a long discussion with useful examples and context.</p>'.repeat(10)}</article>`);
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
try {
  await cp('dist', directory, { recursive: true });
  const manifest = JSON.parse(await readFile(join(directory, 'manifest.json')));
  manifest.host_permissions = ['https://api.notion.com/*', 'http://127.0.0.1/*'];
  manifest.background.scripts.unshift('test-background.js');
  manifest.content_security_policy.extension_pages = manifest.content_security_policy.extension_pages.replace('connect-src https://api.notion.com', `connect-src https://api.notion.com ${origin}`);
  await writeFile(join(directory, 'manifest.json'), JSON.stringify(manifest));
  const html = await readFile(join(directory, 'options.html'), 'utf8');
  await writeFile(join(directory, 'options.html'), html.replace('</body>', '<script src="test-driver.js"></script></body>'));
  const fixture = await readFile('scripts/preview-browser.js', 'utf8');
  // Reuse only the fake HTTP implementation, never the fake browser APIs.
  const fakeHttp = fixture.slice(fixture.indexOf('const fixtureId'), fixture.indexOf('window.browser ='))
    .replaceAll('window.', 'globalThis.').replace('const nativeFetch = globalThis.fetch;', 'const nativeFetch = globalThis.fetch.bind(globalThis);');
  await writeFile(join(directory, 'test-background.js'), fakeHttp + `\nsetTimeout(() => browser.tabs.create({ url: browser.runtime.getURL('options.html') }), 500);`);
  await writeFile(join(directory, 'test-driver.js'), `
    (async () => {
      const checks = [];
      const assert = (ok, label) => { if (!ok) throw new Error(label); checks.push(label); };
      const send = async (type, payload = {}) => {
        const reply = await browser.runtime.sendMessage({type, ...payload});
        if (!reply?.ok) throw new Error(reply?.error || 'No background reply for ' + type);
        return reply.value;
      };
      try {
        const initial = await send('STATE'); assert(!initial.locked && initial.connections.length === 0, 'opens immediately without a passphrase');
        const connected = await send('CONNECT', {token:'ntn_fixture_token_for_testing_only',name:'Firefox workspace'});
        assert(connected.connections.length === 1, 'connect workspace');
        const search = await send('SEARCH', {connectionId:connected.connections[0].id, query:''});
        assert(search.items.length === 2, 'destination search');
        const tab = await browser.tabs.create({url:${JSON.stringify(origin)},active:true});
        await new Promise(resolve => {
          const onUpdated = (id, info, updatedTab) => { if(id === tab.id && info.status === 'complete' && updatedTab.url?.startsWith(${JSON.stringify(origin)})) {browser.tabs.onUpdated.removeListener(onUpdated);resolve();} };
          browser.tabs.onUpdated.addListener(onUpdated);
          browser.tabs.get(tab.id).then(t => {if(t.status === 'complete' && t.url?.startsWith(${JSON.stringify(origin)})) {browser.tabs.onUpdated.removeListener(onUpdated);resolve();}});
        });
        await browser.tabs.update(tab.id,{active:true});
        const capture = await send('CAPTURE');
        assert(capture.title === 'Real Firefox article' && capture.blocks.length >= 8, 'actual Firefox content script injection and article capture');
        await browser.scripting.executeScript({target:{tabId:tab.id},func:async () => {
          try {await browser.runtime.sendMessage({type:'RESET',confirm:'DELETE'});} catch {}
        }});
        assert((await send('STATE')).connections.length === 1, 'reject privileged messages from webpage content script');
        const saved = await send('SAVE',{connectionId:connected.connections[0].id,capture,destination:search.items[0],title:capture.title,mode:'article'});
        assert(saved.jobs[0].status === 'done', 'real extension save flow with fixture Notion API');
        const stored = await browser.storage.local.get('clipperData');
        assert(stored.clipperData.data.jobs[0].status === 'done', 'persistent browser storage');
        assert(!JSON.stringify(await send('STATE')).includes('ntn_fixture'), 'tokens omitted from UI state');
        assert(!(await send('STATE')).locked, 'no auto-lock or repeated passphrase prompt');
        await fetch(${JSON.stringify(origin + '/result')},{method:'POST',body:JSON.stringify({ok:true,checks})});
      } catch(error) {
        await fetch(${JSON.stringify(origin + '/result')},{method:'POST',body:JSON.stringify({ok:false,error:error.message,checks})});
      }
    })();
  `);
  runner = await cmd.run({ sourceDir: directory, artifactsDir: resolve('artifacts'), firefox: process.env.FIREFOX_BINARY || '/Applications/Firefox.app/Contents/MacOS/firefox', args: ['-headless'], noInput: true, noReload: true });
  const timeout = setTimeout(() => finish({ok:false,error:'Firefox test timed out'}), 30_000);
  const outcome = await result; clearTimeout(timeout);
  assert.equal(outcome.ok, true, JSON.stringify(outcome));
  console.log(`Firefox extension integration: ${outcome.checks.length} checks passed`);
  outcome.checks.forEach(check => console.log('  ✓ ' + check));
} finally {
  if (runner) await runner.exit();
  await new Promise(resolve => server.close(resolve));
  await rm(directory, {recursive:true,force:true});
}
