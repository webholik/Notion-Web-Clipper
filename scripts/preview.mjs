import { createLocalServer } from './local-server.mjs';
const demo = process.argv.includes('--demo');
const port = Number(process.argv.find((arg) => arg.startsWith('--port='))?.split('=')[1] || 4173);
if (!Number.isInteger(port) || port < 1024 || port > 65535)
  throw new Error('Choose a valid local port.');
createLocalServer({ demo }).listen(port, '127.0.0.1', () =>
  console.log(`${demo ? 'Demo fixtures' : 'Live Notion app'}: http://127.0.0.1:${port}/popup.html`),
);
