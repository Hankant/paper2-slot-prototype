// @vitest-environment node
// crypto.randomUUID is secure-context only; plain-HTTP LAN origins (campus
// pilot) must fall back to getRandomValues.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { randomId } from '../../src/uuid.js';

const V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe('randomId', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('uses crypto.randomUUID when available', () => {
    const native = vi.fn(() => '11111111-1111-4111-8111-111111111111');
    vi.stubGlobal('crypto', { randomUUID: native });
    expect(randomId()).toBe('11111111-1111-4111-8111-111111111111');
    expect(native).toHaveBeenCalledOnce();
  });

  it('falls back to getRandomValues when randomUUID is missing (insecure context)', () => {
    const real = globalThis.crypto;
    vi.stubGlobal('crypto', { getRandomValues: real.getRandomValues.bind(real) });
    const ids = new Set(Array.from({ length: 200 }, () => randomId()));
    expect(ids.size).toBe(200);
    for (const id of ids) expect(id).toMatch(V4);
  });

  it('reports unsupported randomness instead of using weak random IDs', () => {
    vi.stubGlobal('crypto', undefined);
    expect(() => randomId()).toThrow('不支持安全随机数');
  });
});
