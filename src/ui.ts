import type { CapturePreview, Destination, PublicState } from './model';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const isOptions = location.pathname.endsWith('/options.html');
let showingClip = !isOptions;
let addingWorkspace = false;
document.body.classList.toggle('options', isOptions);
let state: PublicState;
let capture: CapturePreview | undefined;
let selected: Destination | undefined;
let cursor: string | undefined;
let searchSequence = 0;
let searchTimer: ReturnType<typeof setTimeout> | undefined;
let saveBusy = false;
let lastConnections = '';
const value = (id: string) => $<HTMLInputElement>(id).value;

const show = (id: string, visible: boolean) => {
  const element = document.getElementById(id);
  if (element) element.hidden = !visible;
};

function notice(text: string, error = false) {
  $('notice').textContent = text;
  $('notice').classList.toggle('error', error);
  show('notice', !!text);
}

async function send<T>(type: string, payload: object = {}): Promise<T> {
  const reply = await browser.runtime.sendMessage({ type, ...payload });
  if (!reply?.ok)
    throw new Error(
      reply?.error || 'The clipper could not complete this action. Reopen it and try again.',
    );
  return reply.value as T;
}

function button(text: string, action: () => Promise<void>, className = 'text-button') {
  const b = document.createElement('button');
  b.textContent = text;
  b.className = className;
  b.addEventListener('click', () => void perform(b, action));
  return b;
}

// Disable an action while it runs, report errors, then restore its original child elements.
async function perform(element: HTMLButtonElement, action: () => Promise<void>) {
  const children = Array.from(element.childNodes);
  element.disabled = true;
  element.setAttribute('aria-busy', 'true');
  notice('');
  try {
    await action();
  } catch (e) {
    notice(e instanceof Error ? e.message : 'Something went wrong. Try again.', true);
  } finally {
    element.disabled = false;
    element.removeAttribute('aria-busy');
    element.replaceChildren(...children);
    updateSave();
  }
}

function workspace() {
  return value('workspace');
}

function updateSave() {
  const mode = document.querySelector<HTMLInputElement>('input[name="mode"]:checked')?.value;
  $<HTMLButtonElement>('save').disabled =
    saveBusy ||
    !capture ||
    !selected ||
    !workspace() ||
    !value('clip-title').trim() ||
    (mode === 'article' && !capture.blockCount);
}

function selectDestination(d?: Destination) {
  selected = d;
  $('destination-name').textContent = d?.name || 'Choose a page or database';
  updateSave();
}

// Rebuild connection choices only when the saved list or active selection changes.
function renderConnections() {
  const connectionSignature = JSON.stringify([state.connections, state.activeConnectionId]);
  if (lastConnections !== connectionSignature) {
    const previous = workspace();
    $<HTMLSelectElement>('workspace').replaceChildren(
      ...state.connections.map((c) => new Option(c.name, c.id)),
    );
    const chosen = state.activeConnectionId ?? previous;
    if (state.connections.some((c) => c.id === chosen))
      $<HTMLSelectElement>('workspace').value = chosen;
    lastConnections = connectionSignature;
    selectDestination(state.recent[workspace()]);
  }
  $('connected-list').replaceChildren();
  for (const connection of state.connections) {
    const row = document.createElement('div');
    row.className = 'connection-row';
    const name = document.createElement('span');
    name.textContent = connection.name;
    name.textContent += connection.id === state.activeConnectionId ? ' · Selected' : '';
    const actions = document.createElement('div');
    actions.className = 'connection-actions';
    actions.append(
      button(`Use ${connection.name}`, async () => {
        const next = await send<PublicState>('SELECT_WORKSPACE', { connectionId: connection.id });
        showingClip = true;
        addingWorkspace = false;
        renderState(next);
        if (!capture) await captureCurrent();
      }),
      button(
        'Remove',
        async () => {
          if (
            confirm(
              'Remove this workspace connection from this device? Saved ' +
                'Notion pages will remain.',
            )
          )
            renderState(await send('DISCONNECT', { connectionId: connection.id }));
        },
        'text-button danger',
      ),
    );
    row.append(name, actions);
    $('connected-list').append(row);
  }
}

// Render saved progress with resume controls and manual recovery for uncertain page creation.
function renderJobs() {
  show('activity', !!state.jobs.length);
  $('job-count').textContent = `${state.jobs.filter((j) => j.status === 'done').length} saved`;
  $('jobs').replaceChildren();
  for (const job of state.jobs) {
    const row = document.createElement('article');
    row.className = 'job';
    const title = document.createElement('p');
    title.className = 'job-title';
    title.textContent = job.title;
    const meta = document.createElement('p');
    meta.className = 'job-meta';
    const statuses = {
      queued: 'Queued on this device',
      creating: 'Creating page…',
      writing: `Saving content · ${job.next}/${job.blocks.length}`,
      paused: 'Paused · ready to resume',
      uncertain: 'Check Notion before continuing',
      done: 'Saved to Notion',
    };
    meta.textContent = `${statuses[job.status]} · ${job.destination.name}`;
    row.append(title, meta);
    if (job.error) {
      const error = document.createElement('p');
      error.className = 'job-error';
      error.textContent = job.error;
      row.append(error);
    }
    const actions = document.createElement('div');
    actions.className = 'job-actions';
    if (job.pageUrl && /^https:\/\//.test(job.pageUrl)) {
      const open = document.createElement('a');
      open.textContent = 'Open in Notion ↗';
      open.href = job.pageUrl;
      open.target = '_blank';
      open.rel = 'noreferrer';
      actions.append(open);
    }
    if (job.status !== 'done' && job.status !== 'uncertain') {
      const resume = button('Resume', async () => {
        renderState(await send('RESUME', { jobId: job.id }));
      });
      resume.disabled = saveBusy;
      actions.append(resume);
    }
    const remove = button(job.status === 'done' ? 'Clear' : 'Remove capture', async () => {
      if (
        job.status === 'done' ||
        confirm(
          'Remove this pending capture? Any partial page already ' +
            'created in Notion will remain.',
        )
      )
        renderState(await send('DELETE_JOB', { jobId: job.id }));
    });
    remove.disabled = saveBusy;
    actions.append(remove);
    row.append(actions);
    if (job.status === 'uncertain') {
      const form = document.createElement('form');
      form.className = 'job-attach';
      const label = document.createElement('label');
      label.htmlFor = `recover-${job.id}`;
      label.textContent = 'Find the page in Notion, then paste its URL';
      const input = document.createElement('input');
      input.id = label.htmlFor;
      input.placeholder = 'https://www.notion.so/…';
      input.type = 'url';
      input.required = true;
      const submit = document.createElement('button');
      submit.type = 'submit';
      submit.className = 'secondary';
      submit.textContent = 'Verify page and resume';
      form.addEventListener('submit', (e) => {
        e.preventDefault();
        void perform(submit, async () => {
          renderState(await send('ATTACH', { jobId: job.id, pageId: input.value }));
        });
      });
      const hint = document.createElement('p');
      hint.className = 'fine';
      hint.textContent =
        'If no page was created, remove this capture and clip again ' + 'after checking Notion.';
      form.append(label, input, submit, hint);
      row.append(form);
    }
    $('jobs').append(row);
  }
}

function renderState(next: PublicState) {
  state = next;
  show('loading', false);
  show('settings', !isOptions || showingClip);
  show('connections', !showingClip || state.connections.length === 0);
  show('clip', showingClip && state.connections.length > 0);
  show('privacy', isOptions && !showingClip);
  const hasConnections = state.connections.length > 0;
  $('connections-title').textContent = hasConnections ? 'Your workspaces' : 'Connect a workspace';
  $('connections-copy').textContent = hasConnections
    ? 'Your connections are saved. Choose a workspace to continue ' +
      'clipping—no need to connect again.'
    : 'Use your own Notion integration. Clips go directly from ' + 'Firefox to Notion.';
  show('connection-setup', !hasConnections || addingWorkspace);
  show('add-workspace', hasConnections);
  $('add-workspace').textContent = addingWorkspace
    ? 'Cancel adding workspace'
    : 'Add another workspace';
  $('add-workspace').setAttribute('aria-expanded', String(addingWorkspace));
  renderConnections();
  renderJobs();
  updateSave();
}

// Refresh title, capture mode and preview from the extension or local-app capture source.
async function captureCurrent() {
  $('source').textContent = 'Reading the current page…';
  capture = undefined;
  updateSave();
  try {
    capture = await send<CapturePreview>('CAPTURE');
    if (!capture.url) {
      capture = undefined;
      $('source').textContent = 'Add a webpage URL to get started';
      $('capture-summary').textContent = 'NO PAGE SELECTED';
      $('excerpt').textContent = '';
      updateSave();
      return;
    }
    $('source').textContent = new URL(capture.url).hostname;
    $<HTMLTextAreaElement>('clip-title').value = capture.title;
    $('excerpt').textContent =
      capture.excerpt ||
      (capture.blockCount
        ? 'Article captured and ready to save.'
        : 'Keep a bookmark to this page.');
    $('capture-summary').textContent = capture.blockCount
      ? `${capture.blockCount} CONTENT BLOCKS · READY`
      : 'LINK READY';
    $('capture-warning').textContent = capture.warning || '';
    show('capture-warning', !!capture.warning);
    $<HTMLInputElement>('clip-title').disabled = false;
    const article = document.querySelector<HTMLInputElement>('input[value="article"]')!;
    article.disabled = !capture.blockCount;
    if (!capture.blockCount)
      document.querySelector<HTMLInputElement>('input[value="link"]')!.checked = true;
  } catch (e) {
    $('source').textContent = 'No webpage selected';
    $('capture-summary').textContent = 'OPEN A WEBPAGE TO CLIP';
    $('excerpt').textContent = '';
    notice(e instanceof Error ? e.message : 'Could not capture this page.', true);
  }
  updateSave();
}

// Paginate destination searches and discard responses superseded by newer typing or selection.
async function searchDestinations(append = false) {
  clearTimeout(searchTimer);
  const sequence = ++searchSequence;
  const connectionId = workspace();
  const query = value('search');
  if (!append) {
    $('destinations').replaceChildren();
    cursor = undefined;
    show('more', false);
  }
  $('destination-status').textContent = 'Searching your shared pages and databases…';
  try {
    const result = await send<{ items: Destination[]; cursor?: string }>('SEARCH', {
      connectionId,
      query,
      ...(append && cursor ? { cursor } : {}),
    });
    if (sequence !== searchSequence || workspace() !== connectionId) return;
    if (!append) $('destinations').replaceChildren();
    cursor = result.cursor;
    show('more', !!cursor);
    $('destination-status').textContent = result.items.length
      ? 'Choose where this page belongs.'
      : 'No more matches. Make sure your integration has access in Notion.';
    for (const item of result.items) {
      const option = button(
        '',
        async () => {
          selectDestination(item);
          show('destination-picker', false);
          $('choose-destination').setAttribute('aria-expanded', 'false');
          $('choose-destination').focus();
        },
        'destination-option',
      );
      const title = document.createElement('span');
      title.textContent = item.name;
      const kind = document.createElement('small');
      kind.textContent = item.kind === 'page' ? 'Page' : 'Database';
      option.append(title, kind);
      $('destinations').append(option);
    }
  } catch (e) {
    if (sequence === searchSequence) {
      $('destinations').replaceChildren();
      $('destination-status').textContent =
        e instanceof Error ? e.message : 'Could not search Notion. Try again.';
    }
    throw e;
  }
}

$('connect-form').addEventListener('submit', (e) => {
  e.preventDefault();
  // Permission requests must begin inside the user's click/submit gesture.
  const permission = browser.permissions.request({ origins: ['https://api.notion.com/*'] });
  void perform($('connect'), async () => {
    if (!(await permission))
      throw new Error('Notion API access is needed to connect your workspace.');
    const token = value('token');
    $<HTMLInputElement>('token').value = '';
    const next = await send<PublicState>('CONNECT', { token, name: value('connection-name') });
    $<HTMLInputElement>('connection-name').value = '';
    addingWorkspace = false;
    renderState(next);
    notice('Workspace connected. Return to a webpage and open Pocket ' + 'Clipper to save it.');
  });
});
$('settings')?.addEventListener('click', () => {
  if (isOptions) {
    showingClip = false;
    renderState(state);
  } else void browser.runtime.openOptionsPage();
});
$('add-workspace').addEventListener('click', () => {
  addingWorkspace = !addingWorkspace;
  renderState(state);
  if (addingWorkspace) $('connection-name').focus();
});
$('forget').addEventListener(
  'click',
  () =>
    void perform($('forget'), async () => {
      if (
        confirm(
          'Delete every local connection and capture? This cannot be ' +
            'undone. Your pages in Notion will remain.',
        )
      )
        renderState(await send('RESET', { confirm: 'DELETE' }));
    }),
);
$('workspace').addEventListener('change', () => {
  searchSequence++;
  selectDestination(state.recent[workspace()]);
  $('destinations').replaceChildren();
  show('destination-picker', false);
  $('choose-destination').setAttribute('aria-expanded', 'false');
  cursor = undefined;
  void send<PublicState>('SELECT_WORKSPACE', { connectionId: workspace() })
    .then(renderState)
    .catch((e) => notice(e.message, true));
});
$('clip-title').addEventListener('input', updateSave);
document
  .querySelectorAll('input[name="mode"]')
  .forEach((input) => input.addEventListener('change', updateSave));
$('recapture').addEventListener('click', () => void perform($('recapture'), captureCurrent));
$('choose-destination').addEventListener('click', () => {
  const opening = !!$('destination-picker').hidden;
  show('destination-picker', opening);
  $('choose-destination').setAttribute('aria-expanded', String(opening));
  if (opening) {
    $('search').focus();
    void perform($('choose-destination'), () => searchDestinations());
  }
});
$('search-form').addEventListener('submit', (e) => {
  e.preventDefault();
  void perform($<HTMLFormElement>('search-form').querySelector('button')!, () =>
    searchDestinations(),
  );
});
$('search').addEventListener('input', () => {
  clearTimeout(searchTimer);
  searchSequence++;
  $('destinations').replaceChildren();
  show('more', false);
  $('destination-status').textContent = 'Searching…';
  searchTimer = setTimeout(() => {
    if (!$('destination-picker').hidden) void searchDestinations().catch(() => {});
  }, 300);
});
$('more').addEventListener('click', () => void perform($('more'), () => searchDestinations(true)));
$('save').addEventListener(
  'click',
  () =>
    void perform($('save'), async () => {
      saveBusy = true;
      $('save').textContent = 'Saving your page…';
      updateSave();
      const poll = setInterval(() => {
        void send<PublicState>('STATE')
          .then(renderState)
          .catch(() => {});
      }, 1200);
      try {
        renderState(
          await send<PublicState>('SAVE', {
            connectionId: workspace(),
            captureId: capture!.id,
            destination: selected,
            title: value('clip-title'),
            mode: document.querySelector<HTMLInputElement>('input[name="mode"]:checked')?.value,
          }),
        );
        const latest = state.jobs[0];
        notice(
          latest?.status === 'done'
            ? 'Saved. Your next read is waiting in Notion.'
            : 'Your capture is stored on this device. Review it below to continue.',
          latest?.status !== 'done',
        );
      } finally {
        clearInterval(poll);
        saveBusy = false;
        renderJobs();
      }
    }),
);

async function start() {
  if (typeof browser === 'undefined') {
    show('loading', false);
    notice(
      'Open this page from the installed Firefox extension. See ' + 'README.md for setup.',
      true,
    );
    return;
  }
  // Hold a port so the background keeps the pending capture while this UI is open.
  browser.runtime.connect?.({ name: 'clipper-ui' });
  try {
    renderState(await send<PublicState>('STATE'));
    if (!isOptions) await captureCurrent();
  } catch (e) {
    show('loading', false);
    notice(e instanceof Error ? e.message : 'Could not open the clipper.', true);
  }
}
void start();
