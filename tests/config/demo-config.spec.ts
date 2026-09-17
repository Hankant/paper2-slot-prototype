import { describe, expect, it } from 'vitest';

import {
  DEMO_CONFIG_VERSION,
  capabilityMapEquals,
  satisfiesRequired,
} from '../../src/contracts/index.js';
import { REAL_DEMO_CAPABILITIES } from '../fixtures/session-fixtures.js';
import {
  DEMO_BANNER_TEXT,
  demoCapabilitiesEqual,
  demoCapabilitiesSatisfyProduction,
  demoConfiguration,
} from '../../config/demo.js';

describe('config/demo (G0 demo configuration)', () => {
  it('matches the frozen DEMO_CONFIG_VERSION', () => {
    expect(demoConfiguration.configVersion).toBe(DEMO_CONFIG_VERSION);
  });

  it('is flagged simulation:true and never production-ready', () => {
    expect(demoConfiguration.simulation).toBe(true);
  });

  it('mirrors the fixtures it is supposed to mirror', () => {
    expect(demoCapabilitiesEqual(REAL_DEMO_CAPABILITIES.capabilities)).toBe(true);
  });

  it('fails the production hard-floor — required capability keys are unverified', () => {
    expect(satisfiesRequired(demoConfiguration.capabilities)).toBe(false);
  });

  it('reference-checks: capability map equality is value-level', () => {
    expect(
      capabilityMapEquals(demoConfiguration.capabilities, REAL_DEMO_CAPABILITIES.capabilities),
    ).toBe(true);
  });

  it('exposes a SIMULATION banner string that explicitly names simulation', () => {
    expect(DEMO_BANNER_TEXT).toMatch(/SIMULATION/);
  });

  it('re-exports the production-floor helper that B/C/D will call', () => {
    expect(typeof demoCapabilitiesSatisfyProduction).toBe('function');
  });
});
