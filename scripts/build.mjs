import { build } from 'esbuild';
import { cp, mkdir, rm } from 'node:fs/promises';
await rm('dist', { recursive: true, force: true });
await mkdir('dist', { recursive: true });
await cp('public', 'dist', { recursive: true });
await build({ entryPoints: { background: 'src/background.ts', capture: 'src/capture-entry.ts', ui: 'src/ui.ts' }, outdir: 'dist', bundle: true, format: 'iife', target: 'firefox140', legalComments: 'eof' });
await cp('node_modules/@mozilla/readability/LICENSE.md', 'dist/READABILITY-LICENSE.txt');
console.log('Built Firefox extension in dist/');
