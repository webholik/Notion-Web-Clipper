import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, extname } from 'node:path';
const root = resolve('dist');
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml' };
const server = createServer(async (req, res) => {
  const path = new URL(req.url, 'http://localhost').pathname;
  try {
    if (path === '/preview.js') {
      res.setHeader('Content-Type', 'text/javascript');
      res.end(await readFile('scripts/preview-browser.js')); return;
    }
    const file = resolve(root, '.' + (path === '/' ? '/popup.html' : path));
    if (!file.startsWith(root + '/')) { res.writeHead(403).end(); return; }
    let body = await readFile(file);
    if (extname(file) === '.html') body = Buffer.from(body.toString().replace('<script src="ui.js"', '<script src="preview.js" defer></script><script src="background.js" defer></script><script src="ui.js"'));
    res.setHeader('Content-Type', types[extname(file)] || 'text/plain');
    res.setHeader('Cache-Control', 'no-store'); res.end(body);
  } catch { res.writeHead(404).end('Not found'); }
});
server.listen(4173, '127.0.0.1', () => console.log('Local demo: http://127.0.0.1:4173/popup.html (fixture workspace, no Notion requests)'));
