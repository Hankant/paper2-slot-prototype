import { sha256 } from '@noble/hashes/sha2.js';

/** Same SHA-256 over exact UTF-8 bytes, including HTTP origins without SubtleCrypto. */
export async function textHash(text: string): Promise<string> {
  const input = new TextEncoder().encode(text);
  const subtle = globalThis.crypto?.subtle;
  const bytes =
    typeof subtle?.digest === 'function'
      ? new Uint8Array(await subtle.digest('SHA-256', input))
      : sha256(input);
  return Array.from(bytes, (v) => v.toString(16).padStart(2, '0')).join('');
}
