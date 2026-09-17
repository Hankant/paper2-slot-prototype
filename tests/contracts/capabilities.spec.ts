import { describe, expect, it } from 'vitest';

import {
  CAPABILITY_KEYS,
  REQUIRED_CAPABILITIES,
  capabilityMapEquals,
  satisfiesRequired,
} from '../../src/contracts/capabilities.js';
import {
  INSUFFICIENT_CAPABILITIES,
  PRODUCTION_CAPABILITIES,
  REAL_DEMO_CAPABILITIES,
  VALID_CAPABILITIES,
} from '../fixtures/session-fixtures.js';

describe('contracts: capability map helpers', () => {
  it('lists every documented capability key', () => {
    expect(CAPABILITY_KEYS).toEqual([
      'persistentResults',
      'idempotentWrites',
      'resumeSession',
      'serverControlledTrials',
      'serverScoring',
      'individualEntryCodes',
    ]);
  });

  it('declares the documented required-capability set (post-R4)', () => {
    expect(REQUIRED_CAPABILITIES).toEqual([
      'persistentResults',
      'idempotentWrites',
      'serverControlledTrials',
    ]);
  });

  it('marks the demo-actual fixture as failing the production hard-floor', () => {
    expect(satisfiesRequired(REAL_DEMO_CAPABILITIES.capabilities)).toBe(false);
  });

  it('marks the insufficient-fixture as failing the hard-floor', () => {
    expect(satisfiesRequired(INSUFFICIENT_CAPABILITIES.capabilities)).toBe(false);
  });

  it('marks schema-valid capability descriptors that miss a required key as failing', () => {
    expect(satisfiesRequired(VALID_CAPABILITIES.capabilities)).toBe(false);
  });

  it('accepts a hard-floor candidate only when every required key is `supported`', () => {
    expect(satisfiesRequired(PRODUCTION_CAPABILITIES.capabilities)).toBe(true);
  });

  it('treats `unverified` as not supported', () => {
    const fixture = {
      ...PRODUCTION_CAPABILITIES.capabilities,
      idempotentWrites: 'unverified' as const,
    };
    expect(satisfiesRequired(fixture)).toBe(false);
  });

  it('treats `unsupported` as not supported (post-R4)', () => {
    const fixture = {
      ...PRODUCTION_CAPABILITIES.capabilities,
      persistentResults: 'unsupported' as const,
    };
    expect(satisfiesRequired(fixture)).toBe(false);
  });

  it('compares capability maps only when key sets match', () => {
    expect(
      capabilityMapEquals(VALID_CAPABILITIES.capabilities, VALID_CAPABILITIES.capabilities),
    ).toBe(true);
    expect(
      capabilityMapEquals(VALID_CAPABILITIES.capabilities, INSUFFICIENT_CAPABILITIES.capabilities),
    ).toBe(false);
  });
});
