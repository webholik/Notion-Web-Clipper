import { cmd } from 'web-ext';
import { cp, readFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
const { version } = JSON.parse(await readFile('package.json'));
await cmd.build({
  sourceDir: 'dist',
  artifactsDir: 'artifacts',
  overwriteDest: true,
  ignoreFiles: [],
});
await cp(
  `artifacts/pocket_clipper_for_notion-${version}.zip`,
  `artifacts/pocket-clipper-${version}-unsigned.xpi`,
);
execFileSync('python3', ['scripts/package-source.py', version]);
console.log('Unsigned XPI and reviewable source archive created in artifacts/');
