/**
 * Stable error catalog (see docs/CONTRACTS.md §4 and
 * sources/architecture-2026-09-17.md §4.3).
 *
 * Errors are part of the public contract. New codes are added by A; existing
 * codes are never renamed or repurposed (treat as wire-breaking).
 */

export const ERROR_CODES = [
  'INVALID_ENTRY_CODE',
  'SESSION_EXPIRED',
  'INVALID_EVENT',
  'EVENT_CONFLICT',
  'OUT_OF_ORDER',
  'RATE_LIMITED',
  'NETWORK_UNAVAILABLE',
  'PERSISTENCE_UNCONFIRMED',
  'UNSUPPORTED_CAPABILITY',
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];

/** Whether the client may retry the same request without changing input. */
export type Retryable = 'retry' | 'no-retry' | 'user-action';

export interface RuntimeErrorShape {
  code: ErrorCode;
  message: string;
  retryable: Retryable;
  /** Optional data correlated with the failing event; never contains secrets. */
  details?: Readonly<Record<string, unknown>>;
}

export class ContractError extends Error implements RuntimeErrorShape {
  public readonly code: ErrorCode;
  public readonly retryable: Retryable;
  public readonly details?: Readonly<Record<string, unknown>>;

  public constructor(shape: RuntimeErrorShape) {
    super(shape.message);
    this.name = 'ContractError';
    this.code = shape.code;
    this.retryable = shape.retryable;
    if (shape.details !== undefined) {
      this.details = shape.details;
    }
  }
}

export function isContractError(value: unknown): value is ContractError {
  return value instanceof ContractError;
}
