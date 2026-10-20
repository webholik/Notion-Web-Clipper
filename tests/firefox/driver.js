(async () => {
  const checks = [];
  const assert = (ok, label) => {
    if (!ok) throw new Error(label);
    checks.push(label);
  };

  const send = async (type, payload = {}) => {
    const reply = await browser.runtime.sendMessage({ type, ...payload });
    if (!reply?.ok) throw new Error(reply?.error || 'No background reply for ' + type);
    return reply.value;
  };
  try {
    const initial = await send('STATE');
    assert(initial.connections.length === 0, 'opens immediately without a passphrase');
    const connected = await send('CONNECT', {
      token: 'ntn_fixture_token_for_testing_only',
      name: 'Firefox workspace',
    });
    assert(connected.connections.length === 1, 'connect workspace');
    const search = await send('SEARCH', { connectionId: connected.connections[0].id, query: '' });
    assert(search.items.length === 2, 'destination search');
    const tab = await browser.tabs.create({ url: origin, active: true });
    await new Promise((resolve) => {
      const onUpdated = (id, info, updatedTab) => {
        if (id === tab.id && info.status === 'complete' && updatedTab.url?.startsWith(origin)) {
          browser.tabs.onUpdated.removeListener(onUpdated);
          resolve();
        }
      };
      browser.tabs.onUpdated.addListener(onUpdated);
      browser.tabs.get(tab.id).then((t) => {
        if (t.status === 'complete' && t.url?.startsWith(origin)) {
          browser.tabs.onUpdated.removeListener(onUpdated);
          resolve();
        }
      });
    });
    await browser.tabs.update(tab.id, { active: true });
    const capture = await send('CAPTURE');
    assert(
      capture.title === 'Real Firefox article' && capture.blockCount >= 8,
      'actual Firefox content script injection and article capture',
    );
    await browser.scripting.executeScript({
      target: { tabId: tab.id },
      func: async () => {
        try {
          await browser.runtime.sendMessage({ type: 'RESET', confirm: 'DELETE' });
        } catch {}
      },
    });
    assert(
      (await send('STATE')).connections.length === 1,
      'reject privileged messages from webpage content script',
    );
    const saved = await send('SAVE', {
      connectionId: connected.connections[0].id,
      captureId: capture.id,
      destination: search.items[0],
      title: capture.title,
      mode: 'article',
    });
    assert(saved.jobs[0].status === 'done', 'real extension save flow with fixture Notion API');
    const stored = await browser.storage.local.get('clipperData');
    assert(stored.clipperData.data.jobs[0].status === 'done', 'persistent browser storage');
    assert(
      !JSON.stringify(await send('STATE')).includes('ntn_fixture'),
      'tokens omitted from UI state',
    );
    assert((await send('STATE')).connections.length === 1, 'saved connection remains available');
    await fetch(origin + '/result', { method: 'POST', body: JSON.stringify({ ok: true, checks }) });
  } catch (error) {
    await fetch(origin + '/result', {
      method: 'POST',
      body: JSON.stringify({ ok: false, error: error.message, checks }),
    });
  }
})();
