/**
 * Contract version registry.
 *
 * G0 freezes the *form* of public interfaces. Field semantics, capability
 * declarations, and demo configuration are versioned so adapters can detect
 * incompatible rollouts. Versions are bumped by A; B/C/D submit change
 * requests through their handoffs.
 *
 * SemVer 2.0 grammar (subject to PR 0.4.0-rc release candidates):
 *   <major>.<minor>.<patch>(-<pre>)?
 *
 * U0 (immersive UI plan) adds chat-stream types without changing the
 * dotted-triple contract_version; pre-release tags like `0.4.0-rc` are
 * reserved for breaking interface changes.
 */

export const CONTRACT_VERSION = '0.5.0' as const;
export const SCHEMA_VERSION = '0.3.0' as const;
export const PROTOCOL_VERSION = 'unreleased' as const;
export const CLIENT_VERSION = '0.5.0' as const;

export type SemverTag = `${number}.${number}.${number}` | `${number}.${number}.${number}-${string}`;

/** Demo material bundle version. Bumped by A when demo.json content changes. */
export const DEMO_CONFIG_VERSION = 'demo-0.3.0' as const;

/** Strict form of semver used by validators' `semverTag` regex. */
export const SEMVER_TAG_PATTERN = /^(\d+)\.(\d+)\.(\d+)(?:-[0-9A-Za-z.-]+)?$/;
