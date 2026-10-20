import type { Capture, CapturePreview, Destination, Job, PublicState, LocalData } from './model';
import { emptyLocalData, readLocalData, writeLocalData } from './storage';
import { NotionClient, validId } from './notion';
import { safeUrl } from './shared';
import { attachPage, runJob } from './jobs';

let data: LocalData;
let loaded: Promise<void> | undefined;
let serial: Promise<unknown> = Promise.resolve();
// Share the initial storage read so simultaneous UI requests see the same in-memory data.
async function ensureLoaded() {
  if (!loaded)
    loaded = readLocalData(browser.storage.local)
      .then((result) => {
        data = result;
      })
      .catch((error) => {
        loaded = undefined;
        throw error;
      });
  await loaded;
}

// Put a newly completed save first, including captures resumed after newer saves.
async function persist(completedJob?: Job) {
  if (completedJob?.status === 'done') {
    data.jobs = [completedJob, ...data.jobs.filter((job) => job.id !== completedJob.id)];
  }
  await writeLocalData(browser.storage.local, data);
}

// Expose connection labels and clip progress to the UI while keeping tokens in the background.
async function state(): Promise<PublicState> {
  await ensureLoaded();
  return {
    connections: data.connections.map(({ id, name }) => ({ id, name })),
    jobs: data.jobs,
    recent: data.recent,
    activeConnectionId: data.activeConnectionId ?? data.connections[0]?.id,
  };
}

function client(connectionId: string) {
  const connection = data.connections.find((c) => c.id === connectionId);
  if (!connection) throw new Error('Choose a connected workspace.');
  return new NotionClient(connection.token);
}

// Read the active webpage in the isolated content-script context; fall back to a link if blocked.
async function readCapture(): Promise<Capture> {
  const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id || !safeUrl(tab.url ?? ''))
    throw new Error(
      'Open a regular webpage, then launch the clipper from ' + 'Firefox’s Extensions menu.',
    );
  const fallback: Capture = {
    title: tab.title || tab.url!,
    url: tab.url!,
    blocks: [],
    excerpt: '',
    warning: 'Firefox could not read this page. You can still save its link.',
  };
  try {
    // Only inject following a user gesture; no blanket website permission.
    // The scripting API requires activeTab permission; see the MDN link in README.md.
    await browser.scripting.executeScript({ target: { tabId: tab.id }, files: ['capture.js'] });
    const [result] = await browser.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => (globalThis as any).__pocketCapture(),
    });
    if (result.error || !result.result) return fallback;
    return result.result as Capture;
  } catch {
    return fallback;
  }
}

// Keep extracted blocks out of the UI process; the popup only receives a preview.
// A held runtime port prevents the background event page from unloading mid-edit.
const captures = new Map<string, Capture>();
async function capture(): Promise<CapturePreview> {
  const page = await readCapture();
  const id = crypto.randomUUID();
  captures.set(id, page);
  for (const key of captures.keys()) {
    if (captures.size <= 5) break;
    captures.delete(key);
  }
  return {
    id,
    title: page.title,
    url: page.url,
    excerpt: page.excerpt,
    blockCount: page.blocks.length,
    ...(page.warning ? { warning: page.warning } : {}),
  };
}

function destination(value: unknown): Destination {
  const d = value as Destination;
  if (
    !d ||
    !validId(d.id) ||
    !['page', 'data_source'].includes(d.kind) ||
    typeof d.name !== 'string' ||
    typeof d.titleProperty !== 'string'
  )
    throw new Error('Choose a valid destination.');
  return {
    id: d.id,
    kind: d.kind,
    name: d.name.slice(0, 300),
    titleProperty: d.titleProperty,
    ...(d.urlProperty ? { urlProperty: d.urlProperty } : {}),
  };
}

// Route authorized UI actions and persist changes before issuing Notion writes.
async function handle(message: any) {
  await ensureLoaded();
  if (message.type === 'STATE') return state();
  if (message.type === 'CAPTURE') return capture();
  if (message.type === 'RESET') {
    if (message.confirm !== 'DELETE') throw new Error('Confirm deletion first.');
    data = emptyLocalData();
    await persist();
    return state();
  }
  switch (message.type) {
    case 'SELECT_WORKSPACE':
      client(String(message.connectionId));
      data.activeConnectionId = message.connectionId;
      await persist();
      return state();
    case 'CONNECT': {
      const token = typeof message.token === 'string' ? message.token.trim() : '';
      if (!/^[A-Za-z0-9_-]{20,300}$/.test(token))
        throw new Error('Paste a valid Notion integration token.');
      if (!(await browser.permissions.contains({ origins: ['https://api.notion.com/*'] })))
        throw new Error('Allow access to the Notion API to connect.');
      if (data.connections.length >= 10)
        throw new Error('Remove a connection before adding another.');
      const name = await new NotionClient(token).verify();
      const duplicate = data.connections.find((c) => c.token === token);
      if (duplicate) throw new Error('This workspace integration is already connected.');
      data.connections.push({
        id: crypto.randomUUID(),
        name: String(message.name || name)
          .trim()
          .slice(0, 80),
        token,
      });
      await persist();
      return state();
    }
    case 'DISCONNECT': {
      if (data.jobs.some((j) => j.status !== 'done' && j.connectionId === message.connectionId))
        throw new Error('Finish or remove pending clips for this workspace first.');
      data.connections = data.connections.filter((c) => c.id !== message.connectionId);
      if (data.activeConnectionId === message.connectionId)
        data.activeConnectionId = data.connections[0]?.id;
      delete data.recent[message.connectionId];
      await persist();
      return state();
    }
    case 'SEARCH':
      return client(String(message.connectionId)).search(
        String(message.query ?? ''),
        typeof message.cursor === 'string' ? message.cursor : undefined,
      );
    case 'SAVE': {
      const content = captures.get(typeof message.captureId === 'string' ? message.captureId : '');
      if (!content) throw new Error('This capture expired. Refresh the page and try again.');
      if (
        !safeUrl(content.url) ||
        typeof message.title !== 'string' ||
        !message.title.trim() ||
        message.title.length > 1000 ||
        !['article', 'link'].includes(message.mode)
      )
        throw new Error('Enter a title and capture a valid webpage.');
      if (
        !Array.isArray(content.blocks) ||
        content.blocks.length > 1500 ||
        JSON.stringify(content.blocks).length > 3_000_000
      )
        throw new Error('This clip is too large. Use link-only mode.');
      client(message.connectionId);
      if (message.mode === 'article' && !content.blocks.length)
        throw new Error('No readable content was found. Choose link-only mode.');
      const dest = destination(message.destination);
      if (data.jobs.filter((j) => j.status !== 'done').length >= 10)
        throw new Error('Finish or remove a pending clip before saving more.');
      const job: Job = {
        id: crypto.randomUUID(),
        connectionId: message.connectionId,
        title: message.title.trim(),
        source: content.url,
        destination: dest,
        blocks: message.mode === 'article' ? content.blocks : [],
        next: 0,
        status: 'queued',
        createdAt: new Date().toISOString(),
      };
      data.jobs.unshift(job);
      data.recent[message.connectionId] = dest;
      await persist();
      await runJob(job, client(job.connectionId), () => persist(job));
      return state();
    }
    case 'RESUME': {
      const job = data.jobs.find((j) => j.id === message.jobId);
      if (!job || job.status === 'done') throw new Error('Pending clip not found.');
      await runJob(job, client(job.connectionId), () => persist(job));
      return state();
    }
    case 'ATTACH': {
      const job = data.jobs.find((j) => j.id === message.jobId);
      if (!job || job.status === 'done') throw new Error('Pending clip not found.');
      let id = String(message.pageId ?? '').trim();
      if (id.startsWith('https://')) {
        const url = new URL(id);
        if (!(
          url.hostname === 'notion.so' ||
          url.hostname.endsWith('.notion.so') ||
          url.hostname.endsWith('.notion.site')
        ))
          throw new Error('Paste a Notion page URL.');
        id = url.pathname.match(/[0-9a-f]{32}$|[0-9a-f]{8}-[0-9a-f-]{27}$/i)?.[0] ?? '';
      }
      await attachPage(job, id, client(job.connectionId));
      await persist();
      await runJob(job, client(job.connectionId), () => persist(job));
      return state();
    }
    case 'DELETE_JOB':
      data.jobs = data.jobs.filter((j) => j.id !== message.jobId);
      await persist();
      return state();
    default:
      throw new Error('Unsupported clipper action.');
  }
}

// An open UI page keeps the event page alive so its pending capture remains available.
const uiPorts = new Set<browser.runtime.Port>();
browser.runtime.onConnect.addListener((port) => {
  uiPorts.add(port);
  port.onDisconnect.addListener(() => uiPorts.delete(port));
});
// Only packaged extension UI may send privileged messages.
// Requests from webpage content scripts are ignored.
browser.runtime.onMessage.addListener((message, sender) => {
  const allowed = ['popup.html', 'options.html'].map((p) => browser.runtime.getURL(p));
  if (
    sender.id !== browser.runtime.id ||
    !sender.url ||
    !allowed.includes(sender.url.split('?')[0])
  )
    return;
  if (!message || typeof message.type !== 'string')
    return Promise.resolve({ ok: false, error: 'Invalid action.' });
  const task = async () => {
    try {
      return { ok: true, value: await handle(message) };
    } catch (e) {
      return {
        ok: false,
        error: e instanceof Error ? e.message : 'Could not complete this action.',
      };
    }
  };
  // Keep writes serialized. Read-only status can be polled while a save is active.
  if (message.type === 'STATE') return task();
  const result = serial.then(task, task);
  serial = result;
  return result;
});
