import type { Encrypted } from './model';
const encode = (bytes: Uint8Array) => btoa(Array.from(bytes, n => String.fromCharCode(n)).join(''));
const decode = (s: string) => Uint8Array.from(atob(s), c => c.charCodeAt(0));

async function derive(passphrase: string, salt: Uint8Array) {
  const material = await crypto.subtle.importKey('raw', new TextEncoder().encode(passphrase), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey({ name: 'PBKDF2', hash: 'SHA-256', salt: salt as BufferSource, iterations: 600_000 }, material,
    { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}
// A new salt and 96-bit nonce are generated for every persisted snapshot.
export async function seal(value: unknown, passphrase: string): Promise<Encrypted> {
  if (passphrase.length < 12) throw new Error('Use a passphrase with at least 12 characters.');
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const data = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await derive(passphrase, salt), new TextEncoder().encode(JSON.stringify(value)));
  return { version: 1, salt: encode(salt), iv: encode(iv), data: encode(new Uint8Array(data)) };
}
export async function unseal<T>(value: Encrypted, passphrase: string): Promise<T> {
  try {
    if (value.version !== 1) throw new Error();
    const data = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: decode(value.iv) }, await derive(passphrase, decode(value.salt)), decode(value.data));
    return JSON.parse(new TextDecoder().decode(data));
  } catch { throw new Error('Could not unlock. Check your passphrase.'); }
}
