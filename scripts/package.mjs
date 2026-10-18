import { cmd } from 'web-ext';
import { cp, readFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
const { version } = JSON.parse(await readFile('package.json'));
await cmd.build({ sourceDir: 'dist', artifactsDir: 'artifacts', overwriteDest: true, ignoreFiles: [] });
await cp(`artifacts/pocket_clipper_for_notion-${version}.zip`, `artifacts/pocket-clipper-${version}-unsigned.xpi`);
execFileSync('python3', ['-c', `
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED
root = Path.cwd()
paths = ['src', 'public', 'scripts', 'tests', 'docs', 'package.json', 'package-lock.json', 'tsconfig.json', 'playwright.config.ts', 'README.md', '.gitignore']
with ZipFile('artifacts/pocket-clipper-source-${version}.zip', 'w', ZIP_DEFLATED) as archive:
    for name in paths:
        path = root / name
        files = path.rglob('*') if path.is_dir() else [path]
        for file in files:
            if file.is_file():
                archive.write(file, file.relative_to(root))
`]);
console.log('Unsigned XPI and reviewable source archive created in artifacts/');
