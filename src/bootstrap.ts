/**
 * Composition root.
 *
 * G0 only wires:
 *  - the public contract version (frozen by A);
 *  - the demo configuration (loaded from config/demo.json via config/demo.ts);
 *  - a render-time banner that advertises the run as simulation only.
 *
 * Real adapters (`adapters/local-demo`, `adapters/jatos`, `adapters/http`)
 * belong to agent C; experiment timeline + ui belong to agent B. Bootstrapping
 * a real adapter is intentionally left as a follow-up so G0 cannot be confused
 * with a runnable study.
 */

import {
  CLIENT_VERSION,
  CONTRACT_VERSION,
  PROTOCOL_VERSION,
  type SemverTag,
} from './contracts/index.js';

// Re-exported so the ui bundle can confirm the boot-time constants without
// having to dig into contracts individually.
export const BOOT_CONTRACT_VERSION: SemverTag = CONTRACT_VERSION;
export const BOOT_PROTOCOL_VERSION: string = PROTOCOL_VERSION;
export const BOOT_CLIENT_VERSION: SemverTag = CLIENT_VERSION;

export {
  demoConfiguration,
  demoCapabilitiesSatisfyProduction,
  DEMO_BANNER_TEXT,
} from '../config/demo.js';

export interface BootstrapReport {
  readonly contract_version: SemverTag;
  readonly protocol_version: string;
  readonly client_version: SemverTag;
  readonly simulation: true;
  readonly adapter_wired: false;
}

export function reportBootstrap(): BootstrapReport {
  return {
    contract_version: CONTRACT_VERSION,
    protocol_version: PROTOCOL_VERSION,
    client_version: CLIENT_VERSION,
    simulation: true,
    adapter_wired: false,
  };
}
