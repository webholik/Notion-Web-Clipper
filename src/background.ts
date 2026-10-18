import type { Capture, Destination, Encrypted, Job, PublicState, VaultData } from './model';
import { seal, unseal } from './vault';
import { NotionClient, validId } from './notion';
import { safeUrl } from './shared';
import { attachPage, runJob } from './jobs';

let data: VaultData | undefined;
let passphrase: string | undefined;
let lastActivity = 0;
let activeJob = false;
let serial: Promise<unknown> = Promise.resolve();
const empty = (): VaultData => ({ connections: [], jobs: [], recent: {} });
async function persist() {
  if (!data || !passphrase) throw new Error('Unlock your clipper first.');
  await browser.storage.local.set({ vault: await seal(data, passphrase) });
}
function requireVault(): VaultData {
  if (!data || !passphrase) throw new Error('Unlock your clipper first.');
  return data;
}
async function state(): Promise<PublicState> {
  if (!activeJob && Date.now() - lastActivity > 15 * 60_000) { data = undefined; passphrase = undefined; }
  const exists = !!(await browser.storage.local.get('vault')).vault;
  return { exists, locked: !data, connections: data?.connections.map(({ id, name }) => ({ id, name })) ?? [], jobs: data?.jobs ?? [], recent: data?.recent ?? {} };
}
function client(connectionId: string) {
  const connection = requireVault().connections.find(c => c.id === connectionId);
  if (!connection) throw new Error('Choose a connected workspace.');
  return new NotionClient(connection.token);
}
async function capture(): Promise<Capture> {
  const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id || !safeUrl(tab.url ?? '')) throw new Error('Open a regular webpage, then launch the clipper from Firefox’s Extensions menu.');
  const fallback: Capture = { title: tab.title || tab.url!, url: tab.url!, blocks: [], excerpt: '', warning: 'Firefox could not read this page. You can still save its link.' };
  try {
    // Only inject following a user gesture; no blanket website permission.
    // https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/API/scripting/executeScript
    await browser.scripting.executeScript({ target: { tabId: tab.id }, files: ['capture.js'] });
    const [result] = await browser.scripting.executeScript({ target: { tabId: tab.id }, func: () => (globalThis as any).__pocketCapture() });
    if (result.error || !result.result) return fallback;
    return result.result as Capture;
  } catch { return fallback; }
}
function destination(value: unknown): Destination {
  const d = value as Destination;
  if (!d || !validId(d.id) || !['page', 'data_source'].includes(d.kind) || typeof d.name !== 'string' || typeof d.titleProperty !== 'string') throw new Error('Choose a valid destination.');
  return { id: d.id, kind: d.kind, name: d.name.slice(0, 300), titleProperty: d.titleProperty, ...(d.urlProperty ? { urlProperty: d.urlProperty } : {}) };
}
async function execute(job: Job) {
  activeJob = true;
  try { await runJob(job, client(job.connectionId), persist); }
  finally { activeJob = false; }
}

async function handle(message: any) {
  if (message.type === 'STATE') return state();
  lastActivity = Date.now();
  if (message.type === 'CAPTURE') return capture();
  if (message.type === 'UNLOCK') {
    if (typeof message.passphrase !== 'string' || message.passphrase.length > 1000) throw new Error('Enter your passphrase.');
    const stored = (await browser.storage.local.get('vault')).vault as Encrypted | undefined;
    const unlocked = stored ? await unseal<VaultData>(stored, message.passphrase) : empty();
    if (!Array.isArray(unlocked.connections) || !Array.isArray(unlocked.jobs) || !unlocked.recent) throw new Error('The clipper vault is invalid.');
    if (!stored) {
      await browser.storage.local.set({ vault: await seal(unlocked, message.passphrase) });
    }
    data = unlocked; passphrase = message.passphrase;
    return state();
  }
  if (message.type === 'LOCK') { data = undefined; passphrase = undefined; return state(); }
  if (message.type === 'RESET') {
    if (message.confirm !== 'DELETE') throw new Error('Confirm deletion first.');
    await browser.storage.local.remove('vault'); data = undefined; passphrase = undefined;
    return state();
  }
  const vault = requireVault();
  switch (message.type) {
    case 'CONNECT': {
      const token = typeof message.token === 'string' ? message.token.trim() : '';
      if (!/^[A-Za-z0-9_-]{20,300}$/.test(token)) throw new Error('Paste a valid Notion integration token.');
      if (!await browser.permissions.contains({ origins: ['https://api.notion.com/*'] })) throw new Error('Allow access to the Notion API to connect.');
      if (vault.connections.length >= 10) throw new Error('Remove a connection before adding another.');
      const name = await new NotionClient(token).verify();
      const duplicate = vault.connections.find(c => c.token === token);
      if (duplicate) throw new Error('This workspace integration is already connected.');
      vault.connections.push({ id: crypto.randomUUID(), name: String(message.name || name).trim().slice(0, 80), token });
      await persist(); return state();
    }
    case 'DISCONNECT': {
      if (vault.jobs.some(j => j.connectionId === message.connectionId && j.status !== 'done')) throw new Error('Finish or remove pending clips for this workspace first.');
      vault.connections = vault.connections.filter(c => c.id !== message.connectionId);
      delete vault.recent[message.connectionId];
      await persist(); return state();
    }
    case 'SEARCH': return client(String(message.connectionId)).search(String(message.query ?? ''), typeof message.cursor === 'string' ? message.cursor : undefined);
    case 'SAVE': {
      const content = message.capture as Capture;
      if (!content || !safeUrl(content.url) || typeof message.title !== 'string' || !message.title.trim() || message.title.length > 1000 || !['article', 'link'].includes(message.mode)) throw new Error('Enter a title and capture a valid webpage.');
      if (!Array.isArray(content.blocks) || content.blocks.length > 1500 || JSON.stringify(content.blocks).length > 3_000_000) throw new Error('This clip is too large. Use link-only mode.');
      client(message.connectionId);
      if (message.mode === 'article' && !content.blocks.length) throw new Error('No readable content was found. Choose link-only mode.');
      const dest = destination(message.destination);
      if (vault.jobs.filter(j => j.status !== 'done').length >= 10) throw new Error('Finish or remove a pending clip before saving more.');
      const job: Job = { id: crypto.randomUUID(), connectionId: message.connectionId, title: message.title.trim(), source: content.url,
        destination: dest, blocks: message.mode === 'article' ? content.blocks : [], next: 0, status: 'queued', createdAt: new Date().toISOString() };
      vault.jobs = [...vault.jobs.filter(j => j.status !== 'done'), ...vault.jobs.filter(j => j.status === 'done').slice(0, 19)];
      vault.jobs.unshift(job); vault.recent[message.connectionId] = dest;
      await persist();
      await execute(job);
      return state();
    }
    case 'RESUME': {
      const job = vault.jobs.find(j => j.id === message.jobId);
      if (!job) throw new Error('Clip not found.');
      await execute(job); return state();
    }
    case 'ATTACH': {
      const job = vault.jobs.find(j => j.id === message.jobId);
      if (!job) throw new Error('Clip not found.');
      let id = String(message.pageId ?? '').trim();
      if (id.startsWith('https://')) {
        const url = new URL(id);
        if (!(url.hostname === 'notion.so' || url.hostname.endsWith('.notion.so') || url.hostname.endsWith('.notion.site'))) throw new Error('Paste a Notion page URL.');
        id = url.pathname.match(/[0-9a-f]{32}$|[0-9a-f]{8}-[0-9a-f-]{27}$/i)?.[0] ?? '';
      }
      await attachPage(job, id, client(job.connectionId)); await persist(); await execute(job); return state();
    }
    case 'DELETE_JOB':
      vault.jobs = vault.jobs.filter(j => j.id !== message.jobId); await persist(); return state();
    default: throw new Error('Unsupported clipper action.');
  }
}

// Page content cannot invoke privileged actions. Only packaged extension UI may send these messages.
browser.runtime.onMessage.addListener((message, sender) => {
  const allowed = ['popup.html', 'options.html'].map(p => browser.runtime.getURL(p));
  if (sender.id !== browser.runtime.id || !sender.url || !allowed.includes(sender.url.split('?')[0])) return;
  if (!message || typeof message.type !== 'string') return Promise.resolve({ ok: false, error: 'Invalid action.' });
  const task = async () => {
    try { return { ok: true, value: await handle(message) }; }
    catch (e) { return { ok: false, error: e instanceof Error ? e.message : 'Could not complete this action.' }; }
  };
  // Keep writes serialized. Read-only status can be polled while a save is active.
  if (message.type === 'STATE') return task();
  const result = serial.then(task, task);
  serial = result;
  return result;
});
