import { describe, expect, it } from 'vitest';

import { ERROR_CODES, ContractError, isContractError } from '../../src/contracts/errors.js';
import { contractErrorSchema } from '../../src/contracts/validators.js';

describe('contracts: error catalog', () => {
  it('contains the documented codes (no rename allowed)', () => {
    expect(ERROR_CODES).toEqual([
      'INVALID_ENTRY_CODE',
      'SESSION_EXPIRED',
      'INVALID_EVENT',
      'EVENT_CONFLICT',
      'OUT_OF_ORDER',
      'RATE_LIMITED',
      'NETWORK_UNAVAILABLE',
      'PERSISTENCE_UNCONFIRMED',
      'UNSUPPORTED_CAPABILITY',
    ]);
  });

  it('builds a structured ContractError', () => {
    const err = new ContractError({
      code: 'EVENT_CONFLICT',
      message: 'event_id reused with different payload',
      retryable: 'no-retry',
      details: { event_id: '11111111-1111-4111-8111-111111111111' },
    });
    expect(err.code).toBe('EVENT_CONFLICT');
    expect(err.retryable).toBe('no-retry');
    expect(err.message).toMatch(/event_id reused/);
    expect(err.details).toEqual({
      event_id: '11111111-1111-4111-8111-111111111111',
    });
  });

  it('identifies ContractError via duck-typing', () => {
    const err = new ContractError({
      code: 'NETWORK_UNAVAILABLE',
      message: 'fetch failed',
      retryable: 'retry',
    });
    expect(isContractError(err)).toBe(true);
    expect(isContractError(new Error('plain'))).toBe(false);
    expect(isContractError({ code: 'INVALID_EVENT', message: 'fake' })).toBe(false);
  });

  it('passes through the runtime schema', () => {
    const parsed = contractErrorSchema.parse({
      code: 'PERSISTENCE_UNCONFIRMED',
      message: 'ack pending',
      retryable: 'retry',
      details: { scope: 'browser_local' },
    });
    expect(parsed.code).toBe('PERSISTENCE_UNCONFIRMED');
  });
});
