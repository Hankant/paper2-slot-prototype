/**
 * Capability declarations (see docs/CONTRACTS.md §5).
 *
 * Each adapter declares the capability values it has actually verified.
 * `unsupported` ≠ `unverified`: the latter is admitted as "evidence not yet
 * gathered" and must not silently degrade production sessions.
 *
 * After the Q G0 review (R4), `persistentResults` is a hard-floor capability
 * for any non-demo adapter. C may add additional required keys per formal
 * run; the base floor is defined here so it cannot be circumvented by an
 * adapter narrowly satisfying idempotency + server-controlled trials.
 */

export const CAPABILITY_KEYS = [
  'persistentResults',
  'idempotentWrites',
  'resumeSession',
  'serverControlledTrials',
  'serverScoring',
  'individualEntryCodes',
] as const;

export type CapabilityKey = (typeof CAPABILITY_KEYS)[number];

export type CapabilityStatus = 'supported' | 'unsupported' | 'unverified';

export type CapabilityMap = Readonly<Record<CapabilityKey, CapabilityStatus>>;

export interface Capabilities {
  readonly provider: string;
  readonly adapter_version: string;
  readonly capabilities: CapabilityMap;
}

/**
 * Minimum capability set every adapter MUST claim `supported` before any
 * non-demo session can open. A future production bootstrap must enforce this
 * gate plus the chosen protocol's requirements. The one-trial preview is
 * explicitly memory-only and cannot open a production session.
 */
export const REQUIRED_CAPABILITIES: ReadonlyArray<CapabilityKey> = [
  'persistentResults',
  'idempotentWrites',
  'serverControlledTrials',
];

export function capabilityMapEquals(a: CapabilityMap, b: CapabilityMap): boolean {
  for (const key of CAPABILITY_KEYS) {
    if (a[key] !== b[key]) return false;
  }
  return true;
}

/**
 * Returns `true` when the adapter satisfies every required capability as
 * `supported`. `unverified` is treated as failing — production must not
 * silently downgrade.
 */
export function satisfiesRequired(caps: CapabilityMap): boolean {
  for (const key of REQUIRED_CAPABILITIES) {
    if (caps[key] !== 'supported') return false;
  }
  return true;
}
