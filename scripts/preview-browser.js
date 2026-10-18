// Development only. Never copied into the extension package.
// Exercises the real background and UI, replacing only browser APIs and Notion HTTP.
const fixtureId = '12345678-1234-1234-1234-123456789abc';
const fixturePageId = 'aaaaaaaa-1234-1234-1234-123456789abc';
const fixtureCapture = {
  title: 'A quieter way to collect ideas', url: 'https://example.com/journal/collecting-ideas',
  excerpt: 'The best reading lists start with curiosity. Keep the ideas that make you pause, and give yourself a place to return to them.',
  blocks: [{ object: 'block', type: 'heading_2', heading_2: { rich_text: [{ type: 'text', text: { content: 'Make room for curiosity' } }] } }, { object: 'block', type: 'paragraph', paragraph: { rich_text: [{ type: 'text', text: { content: 'A thoughtful collection is built one good idea at a time.' } }] } }]
};
let listener;
let contents = [];
window.__requests = [];
window.__failAppendOnce = false;
window.__denyPermission = false;
window.__emptyCapture = false;
const nativeFetch = window.fetch;
window.fetch = async (url, options = {}) => {
  if (!String(url).startsWith('https://api.notion.com/')) return nativeFetch(url, options);
  const body = options.body ? JSON.parse(options.body) : undefined;
  window.__requests.push({ path: String(url).split('/v1/')[1], method: options.method, body });
  if (String(url).endsWith('users/me')) return Response.json({ object: 'user', id: fixtureId, name: 'Personal', bot: { workspace_name: 'Personal workspace' } });
  if (String(url).endsWith('/search')) {
    const result = { results: [{ object: 'page', id: fixtureId, properties: { title: { type: 'title', title: [{ plain_text: 'Reading room' }] } } }, { object: 'data_source', id: fixtureId, title: [{ plain_text: 'Article library' }], properties: { Name: { id: 'title', type: 'title' }, URL: { id: 'url', type: 'url' } } }], has_more: false };
    const query = String(body?.query || '').toLowerCase();
    result.results = result.results.filter(row => JSON.stringify(row.object === 'page' ? row.properties.title.title : row.title).toLowerCase().includes(query));
    return Response.json(result);
  }
  if (String(url).includes('/data_sources/')) return Response.json({ properties: { Name: { id: 'title', type: 'title' }, URL: { id: 'url', type: 'url' } } });
  if (String(url).endsWith('/pages') && options.method === 'POST') { contents = [...body.children]; return Response.json({ id: fixturePageId, url: 'https://www.notion.so/' + fixturePageId }); }
  if (String(url).includes('/children')) {
    if (options.method === 'PATCH') {
      contents.push(...body.children);
      if (window.__failAppendOnce) { window.__failAppendOnce = false; throw new TypeError('Simulated connection drop after successful write'); }
      return Response.json({ results: body.children });
    }
    return Response.json({ results: contents, has_more: false });
  }
  if (String(url).includes('/pages/')) return Response.json({ parent: { type: 'page_id', page_id: fixtureId } });
  return Response.json({}, { status: 404 });
};
window.browser = {
  runtime: {
    id: 'preview',
    getURL: path => `${location.origin}/${path}`,
    onMessage: { addListener: fn => { listener = fn; } },
    sendMessage: async message => {
      if (message.type === 'CAPTURE') return { ok: true, value: window.__emptyCapture ? { ...fixtureCapture, blocks: [], warning: 'No readable article found. Save the link instead.' } : fixtureCapture };
      return structuredClone(await listener(message, { id: 'preview', url: location.href }));
    },
    openOptionsPage: async () => { location.href = '/options.html'; }
  },
  permissions: { contains: async () => true, request: async () => !window.__denyPermission },
  storage: { local: {
    get: async key => ({ [key]: JSON.parse(localStorage.getItem(key) || 'null') }),
    set: async record => { Object.entries(record).forEach(([key, value]) => localStorage.setItem(key, JSON.stringify(value))); },
    remove: async key => localStorage.removeItem(key)
  } }
};
document.addEventListener('DOMContentLoaded', () => {
  const ribbon = document.createElement('div'); ribbon.textContent = 'LOCAL DEMO · Fixture workspace · No Notion requests';
  ribbon.className = 'runtime-banner';
  document.body.prepend(ribbon);
});
