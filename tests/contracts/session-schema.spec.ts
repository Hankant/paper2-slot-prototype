import { describe, expect, it } from 'vitest';

import {
  capabilitiesSchema,
  entryCredentialSchema,
  experimentStateSchema,
  sessionSchema,
} from '../../src/contracts/validators.js';
import {
  PRODUCTION_CAPABILITIES,
  REJECTED_CAPABILITIES,
  REJECTED_ENTRY_CREDENTIAL,
  REJECTED_EXPERIMENT_STATE,
  REJECTED_SESSION,
  SUCCESS_ENTRY_CREDENTIAL,
  SUCCESS_EXPERIMENT_STATE,
  SUCCESS_SESSION,
  VALID_CAPABILITIES,
} from '../fixtures/session-fixtures.js';

describe('contracts: session lifecycle shapes', () => {
  it('accepts a well-formed session and trial-state pair', () => {
    expect(() => sessionSchema.parse(SUCCESS_SESSION)).not.toThrow();
    expect(() => experimentStateSchema.parse(SUCCESS_EXPERIMENT_STATE)).not.toThrow();
  });

  it('accepts a well-formed entry credential', () => {
    expect(() => entryCredentialSchema.parse(SUCCESS_ENTRY_CREDENTIAL)).not.toThrow();
  });

  it('rejects a credential that is too short', () => {
    const result = entryCredentialSchema.safeParse(REJECTED_ENTRY_CREDENTIAL);
    expect(result.success).toBe(false);
  });

  it('rejects a session with empty session_id', () => {
    const result = sessionSchema.safeParse(REJECTED_SESSION);
    expect(result.success).toBe(false);
  });

  it('rejects an experiment_state with negative trial_index', () => {
    const result = experimentStateSchema.safeParse(REJECTED_EXPERIMENT_STATE);
    expect(result.success).toBe(false);
  });

  it('rejects an empty provider/adapter capabilities descriptor', () => {
    const result = capabilitiesSchema.safeParse(REJECTED_CAPABILITIES);
    expect(result.success).toBe(false);
  });

  it('parses an honest below-floor descriptor; admission is checked separately', () => {
    const result = capabilitiesSchema.safeParse(VALID_CAPABILITIES);
    expect(result.success).toBe(true);
  });

  it('accepts a capabilities descriptor that meets the production hard-floor (post-R4)', () => {
    expect(() => capabilitiesSchema.parse(PRODUCTION_CAPABILITIES)).not.toThrow();
  });
});
