// Local app only. Never copied into the extension package.
// Reuse the extension's real background, encryption and Notion API client.
const bridgeKey = __LOCAL_BRIDGE_KEY__;
const nativeFetch = window.fetch.bind(window);
let listener;
let capture = { title: '', url: '', excerpt: '', blocks: [] };
window.fetch = (url, options = {}) => {
  if (!String(url).startsWith('https://api.notion.com/v1/')) return nativeFetch(url, options);
  const path = String(url).slice('https://api.notion.com/v1/'.length);
  return nativeFetch(`${location.origin}/api/notion/v1/${path}`, {
    ...options,
    headers: { ...options.headers, 'X-Pocket-Bridge': bridgeKey },
    credentials: 'omit',
  });
};
window.browser = {
  runtime: {
    id: 'local-app',
    getURL: (path) => `${location.origin}/${path}`,
    onMessage: {
      addListener: (fn) => {
        listener = fn;
      },
    },
    onConnect: { addListener: () => {} },
    sendMessage: async (message) =>
      structuredClone(await listener(message, { id: 'local-app', url: location.href })),

    connect: () => ({ disconnect() {}, onDisconnect: { addListener() {} } }),

    openOptionsPage: async () => {
      location.href = '/options.html';
    },
  },
  tabs: {
    query: async () => [
      {
        id: 1,
        url: capture.url || 'https://example.com/',
        title: capture.title || 'example.com',
      },
    ],
  },
  scripting: {
    executeScript: async (options) =>
      options.files ? [{}] : [{ result: structuredClone(capture) }],
  },
  permissions: {
    contains: async () => true,

    request: async () => true,
  },
  storage: {
    local: {
      get: async (key) => ({ [key]: JSON.parse(localStorage.getItem(key) || 'null') }),

      set: async (record) => {
        Object.entries(record).forEach(([key, value]) =>
          localStorage.setItem(key, JSON.stringify(value)),
        );
      },

      remove: async (key) => localStorage.removeItem(key),
    },
  },
};
document.addEventListener('DOMContentLoaded', () => {
  const banner = document.createElement('div');
  banner.className = 'runtime-banner';
  banner.textContent = 'LOCAL APP · Live Notion API';
  document.body.prepend(banner);
  const form = document.createElement('form');
  form.className = 'local-source';
  const label = document.createElement('label');
  label.htmlFor = 'local-url';
  label.textContent = 'Webpage URL';
  const input = document.createElement('input');
  input.id = 'local-url';
  input.type = 'url';
  input.required = true;
  input.placeholder = 'https://example.com/article';
  const submit = document.createElement('button');
  submit.type = 'submit';
  submit.className = 'secondary';
  submit.textContent = 'Use this link';
  const help = document.createElement('p');
  help.className = 'fine';
  help.textContent =
    'Paste a URL to save a link. Use the Firefox extension to ' +
    'capture a full article from the page you’re viewing.';
  form.append(label, input, submit, help);
  document.querySelector('.source-line').before(form);
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    let url;
    try {
      url = new URL(input.value);
    } catch {
      input.setCustomValidity('Enter a valid webpage URL.');
      input.reportValidity();
      return;
    }
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) {
      input.setCustomValidity('Enter an HTTP or HTTPS webpage URL.');
      input.reportValidity();
      return;
    }
    capture = {
      url: url.href,
      title: url.hostname,
      excerpt: 'A link to the original page.',
      blocks: [],
      warning:
        'Link-only capture in the local app. Full article capture is ' +
        'available in the Firefox extension.',
    };
    document.getElementById('recapture').click();
  });
  input.addEventListener('input', () => input.setCustomValidity(''));
});
