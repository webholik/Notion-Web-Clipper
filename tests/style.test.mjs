import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkSource } from '../scripts/check-style.mjs';

test('rejects long source lines and adjacent function definitions', () => {
  assert.match(checkSource('x'.repeat(101), 'example.ts')[0], /100-character limit/);
  const functions = 'function first() {}\nfunction second() {}';
  assert.match(checkSource(functions, 'example.ts')[0], /blank line/);
});

test('accepts spaced functions and ignores function-like text in comments', () => {
  const functions =
    'function first() {}\n\n// Explain the next function.\nfunction ' + 'second() {}';
  assert.deepEqual(checkSource(functions, 'example.ts'), []);
  assert.deepEqual(checkSource('// function example() {}', 'example.ts'), []);
});
