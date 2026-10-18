import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, extname } from 'node:path';
import { randomBytes } from 'node:crypto';

const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml' };
const id = '[0-9a-fA-F-]{32,36}';
const allowed = { GET: new RegExp(`^(users/me|data_sources/${id}|pages/${id}|blocks/${id}/children)$`), POST: /^(search|pages)$/, PATCH: new RegExp(`^blocks/${id}/children$`) };
export function createLocalServer({demo = false, upstreamFetch = fetch} = {}) {
  const root = resolve('dist');
  const bridgeKey = randomBytes(32).toString('base64url');
  const server = createServer(async (req, res) => {
    const origin = `http://127.0.0.1:${server.address().port}`;
    res.setHeader('Cache-Control','no-store'); res.setHeader('X-Content-Type-Options','nosniff'); res.setHeader('Referrer-Policy','no-referrer');
    if (req.headers.host !== new URL(origin).host) { res.writeHead(403).end(); return; }
    const url = new URL(req.url, origin);
    const fail = (status, message) => { res.writeHead(status,{'Content-Type':'application/json'}).end(JSON.stringify({error:message})); };
    try {
      if (url.pathname.startsWith('/api/notion/')) {
        if (demo || req.headers['x-pocket-bridge'] !== bridgeKey || (req.headers.origin && req.headers.origin !== origin) || req.headers['sec-fetch-site'] === 'cross-site') { fail(403,'Local app requests only.'); return; }
        const route = url.pathname.slice('/api/notion/v1/'.length);
        if (!url.pathname.startsWith('/api/notion/v1/') || !allowed[req.method]?.test(route)) { fail(404,'Unsupported Notion operation.'); return; }
        if (!/^Bearer [A-Za-z0-9_-]{20,300}$/.test(req.headers.authorization ?? '')) { fail(401,'A Notion integration token is required.'); return; }
        let size = 0; const chunks = [];
        for await (const chunk of req) { size += chunk.length; if (size > 512_000) { fail(413,'Request is too large.'); return; } chunks.push(chunk); }
        const body = Buffer.concat(chunks).toString('utf8');
        if (body) { try { JSON.parse(body); } catch { fail(400,'Invalid JSON.'); return; } }
        // Fixed HTTPS upstream; never fetch user-provided hosts or forward cookies.
        // Credentials are used in memory for this request and are never logged or stored.
        const upstream = await upstreamFetch(`https://api.notion.com/v1/${route}${url.search}`, {
          method:req.method, headers:{Authorization:req.headers.authorization,'Notion-Version':'2026-03-11','Content-Type':'application/json'},
          ...(body ? {body} : {}), redirect:'error', signal:AbortSignal.timeout(30_000)
        });
        res.statusCode = upstream.status; res.setHeader('Content-Type','application/json');
        if (upstream.headers.get('Retry-After')) res.setHeader('Retry-After',upstream.headers.get('Retry-After'));
        res.end(await upstream.text()); return;
      }
      if (!['GET','HEAD'].includes(req.method)) { fail(405,'Method not allowed.'); return; }
      if (url.pathname === '/preview.js') {
        const script = await readFile(demo ? 'scripts/preview-browser.js' : 'scripts/local-browser.js','utf8');
        res.setHeader('Content-Type','text/javascript'); res.end(script.replace('__LOCAL_BRIDGE_KEY__',JSON.stringify(bridgeKey))); return;
      }
      const file = resolve(root,'.' + (url.pathname === '/' ? '/popup.html' : url.pathname));
      if (!file.startsWith(root + '/')) { fail(403,'Forbidden.'); return; }
      let body = await readFile(file);
      if (extname(file) === '.html') {
        body = Buffer.from(body.toString().replace('<script src="ui.js"','<script src="preview.js" defer></script><script src="background.js" defer></script><script src="ui.js"'));
        res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'");
      }
      res.setHeader('Content-Type',types[extname(file)] || 'text/plain'); res.end(body);
    } catch {
      if (!res.headersSent) fail(url.pathname.startsWith('/api/') ? 502 : 404,url.pathname.startsWith('/api/') ? 'Could not reach Notion. Check your connection.' : 'Not found.');
      else res.end();
    }
  });
  server.requestTimeout = 35_000;
  return server;
}
