import { readdir, readFile } from 'node:fs/promises';
import { extname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parse } from '@babel/parser';

const codeExtensions = new Set(['.ts', '.js', '.mjs', '.css', '.html', '.json', '.svg', '.py']);
const scriptExtensions = new Set(['.ts', '.js', '.mjs']);
const functionTypes = new Set(['FunctionDeclaration', 'ClassMethod', 'ObjectMethod']);
const maximumLineLength = 100;

function isFunctionValue(node) {
  return node && ['ArrowFunctionExpression', 'FunctionExpression'].includes(node.type);
}

function isFunctionDefinition(node) {
  if (!node) return false;
  if (functionTypes.has(node.type)) return true;
  if (node.type === 'ExportNamedDeclaration') return isFunctionDefinition(node.declaration);
  if (node.type === 'VariableDeclaration') {
    return node.declarations.some((declaration) => isFunctionValue(declaration.init));
  }

  return node.type === 'ObjectProperty' && isFunctionValue(node.value);
}

// Inspect neighboring definitions, including class methods, without counting callbacks.
function missingFunctionBreaks(source) {
  const file = parse(source, { sourceType: 'module', plugins: ['typescript'] });
  const positions = [];

  function visit(node) {
    if (!node || typeof node !== 'object') return;
    const definitions = Array.isArray(node.body) ? node.body : node.properties;
    if (Array.isArray(definitions)) {
      for (let index = 1; index < definitions.length; index++) {
        const previous = definitions[index - 1];
        const current = definitions[index];
        if (!isFunctionDefinition(previous) || !isFunctionDefinition(current)) continue;

        const between = source.slice(previous.end, current.start);
        if (!/\n\s*\n/.test(between)) {
          positions.push(current.start);
        }
      }
    }

    for (const [key, child] of Object.entries(node)) {
      if (['loc', 'tokens', 'comments'].includes(key)) continue;
      if (Array.isArray(child)) child.forEach(visit);
      else if (child && typeof child === 'object' && 'type' in child) visit(child);
    }
  }

  visit(file);
  return positions;
}

// Enforce a hard source-line limit and blank lines between neighboring function definitions.
export function checkSource(source, filename) {
  const errors = [];
  source.split('\n').forEach((line, index) => {
    if (line.length > maximumLineLength) {
      errors.push(
        `${filename}:${index + 1}: ${line.length} characters exceeds the 100-character limit`,
      );
    }
  });

  if (scriptExtensions.has(extname(filename))) {
    for (const position of missingFunctionBreaks(source)) {
      const line = source.slice(0, position).split('\n').length;
      errors.push(`${filename}:${line}: add a blank line between function definitions`);
    }
  }

  return errors;
}

async function sourceFiles(directory) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = `${directory}/${entry.name}`;
    if (entry.isDirectory()) files.push(...(await sourceFiles(path)));
    else if (codeExtensions.has(extname(path))) files.push(path);
  }

  return files;
}

async function main() {
  const roots = ['src', 'scripts', 'tests', 'public'];
  const files = (await Promise.all(roots.map(sourceFiles))).flat();
  files.push('package.json', 'tsconfig.json', 'playwright.config.ts', '.prettierrc.json');
  const errors = [];
  for (const filename of files) {
    errors.push(...checkSource(await readFile(filename, 'utf8'), filename));
  }

  if (errors.length) {
    console.error(errors.join('\n'));
    process.exitCode = 1;
    return;
  }

  console.log(`Style checked ${files.length} files: 100-character lines and spaced functions.`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  await main();
}
