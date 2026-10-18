import { test } from 'node:test';
import assert from 'node:assert/strict';
import { seal, unseal } from '../src/vault.ts';
test('encrypts secrets and requires the correct passphrase', async () => {
  const value = [{ id: 'one', name: 'Personal', token: 'ntn_private_test_token' }];
  const encrypted = await seal(value, 'a long passphrase');
  assert.ok(!JSON.stringify(encrypted).includes('ntn_private'));
  assert.deepEqual(await unseal(encrypted, 'a long passphrase'), value);
  await assert.rejects(unseal(encrypted, 'incorrect passphrase'), /passphrase|unlock/i);
});
test('uses fresh salt and nonce for each encryption', async () => {
  const a = await seal([], 'a long passphrase');
  const b = await seal([], 'a long passphrase');
  assert.notEqual(a.iv, b.iv);
  assert.notEqual(a.salt, b.salt);
});
test('accepts passphrases without length or required-value validation', async () => {
  for (const passphrase of ['', 'a', 'long'.repeat(300)]) {
    const encrypted = await seal({ saved: true }, passphrase);
    assert.deepEqual(await unseal(encrypted, passphrase), { saved: true });
  }
});
