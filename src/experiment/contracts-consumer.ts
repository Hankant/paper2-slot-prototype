/**
 * Consumer compile-check for the public contracts barrel.
 *
 * B / C / D import path is `@contracts/*`. This file exercises that path
 * in a real type-checked surface so reviewers can confirm the alias resolves
 * under the G0 toolchain (tsconfig paths + Vite alias + Vitest alias).
 *
 * It does NOT instantiate any behavior — it only imports types and helpers
 * from each contracts submodule to make sure the alias is real.
 */

import {
  CAPABILITY_KEYS,
  CONTRACT_VERSION,
  REQUIRED_CAPABILITIES,
  publicTrialSchema,
  satisfiesRequired,
} from '@contracts/index.js';

void CONTRACT_VERSION;
void CAPABILITY_KEYS;
void REQUIRED_CAPABILITIES;
void publicTrialSchema;
void satisfiesRequired;

export const CONSUMER_PROBE = {
  contractVersion: CONTRACT_VERSION,
  capabilityKeys: [...CAPABILITY_KEYS],
  requiredCapabilities: [...REQUIRED_CAPABILITIES],
} as const;
