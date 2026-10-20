import { build } from 'esbuild';
import { cp, mkdir, rm, readFile, writeFile } from 'node:fs/promises';
await rm('dist', { recursive: true, force: true });
await mkdir('dist', { recursive: true });
await cp('public', 'dist', { recursive: true });
// Keep the manifest's long policy readable without changing the emitted CSP.
const manifest = JSON.parse(await readFile('public/manifest.json', 'utf8'));
const { version } = JSON.parse(await readFile('package.json', 'utf8'));
manifest.version = version;
manifest.content_security_policy = {
  extension_pages: [
    "script-src 'self'",
    "object-src 'none'",
    "base-uri 'none'",
    "frame-ancestors 'none'",
    'connect-src https://api.notion.com',
  ].join('; '),
};
await writeFile('dist/manifest.json', JSON.stringify(manifest, null, 2));

await build({
  entryPoints: {
    background: 'src/background.ts',
    capture: 'src/capture-entry.ts',
    ui: 'src/ui.ts',
  },
  outdir: 'dist',
  bundle: true,
  format: 'iife',
  target: 'firefox140',
  legalComments: 'eof',
});
await cp('node_modules/@mozilla/readability/LICENSE.md', 'dist/READABILITY-LICENSE.txt');
console.log('Built Firefox extension in dist/');
