import sys
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED


version = sys.argv[1]
root = Path.cwd()
paths = [
    'src', 'public', 'scripts', 'tests', 'docs',
    'package.json', 'package-lock.json', 'tsconfig.json',
    'playwright.config.ts', 'README.md', '.gitignore',
    '.prettierrc.json', '.prettierignore',
]
with ZipFile(f'artifacts/pocket-clipper-source-{version}.zip', 'w', ZIP_DEFLATED) as archive:
    for name in paths:
        path = root / name
        files = path.rglob('*') if path.is_dir() else [path]
        for file in files:
            if file.is_file():
                archive.write(file, file.relative_to(root))
