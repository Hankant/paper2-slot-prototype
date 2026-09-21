// @vitest-environment node
import { createHash } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { textHash } from '../../src/domain/text-hash.js';

describe('SHA-256 text compatibility', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });
  const texts = [
    '',
    'abc',
    '本轮建议：机器 B 🎰\r\n保留空格 ',
    'a'.repeat(55),
    'a'.repeat(56),
    'a'.repeat(64),
    '预测'.repeat(2000),
    '\ud800',
  ];
  for (const native of [true, false]) {
    it(`matches Node SHA-256 for UTF-8 and block boundaries (native=${native})`, async () => {
      if (!native) vi.stubGlobal('crypto', {});
      for (const text of texts) {
        expect(await textHash(text)).toBe(createHash('sha256').update(text, 'utf8').digest('hex'));
      }
    });
  }
  it('propagates native digest failures rather than bypassing integrity checks', async () => {
    vi.stubGlobal('crypto', {
      subtle: { digest: vi.fn().mockRejectedValue(new Error('digest failed')) },
    });
    await expect(textHash('abc')).rejects.toThrow('digest failed');
  });
});
