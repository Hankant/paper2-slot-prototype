/**
 * Contract version registry.
 *
 * G0 freezes the *form* of public interfaces. Field semantics, capability
 * declarations, and demo configuration are versioned so adapters can detect
 * incompatible rollouts. Versions are bumped by A; B/C/D submit change
 * requests through their handoffs.
 *
 * Historical marker: the doc-level drafts in docs/CONTRACTS.md are
 * `DRAFT`; once types land in TypeScript, contract_version advances to
 * a semver string. protocol_version, schema_version, and material_version
 * are separate axes (interface contract, on-wire schema, study content).
 */

export const CONTRACT_VERSION = '0.3.0' as const;
export const SCHEMA_VERSION = '0.3.0' as const;
export const PROTOCOL_VERSION = 'unreleased' as const;
export const CLIENT_VERSION = '0.3.0' as const;

export type SemverTag = `${number}.${number}.${number}`;

/** Demo material bundle version. Bumped by A when demo.json content changes. */
export const DEMO_CONFIG_VERSION = 'demo-0.3.0' as const;
