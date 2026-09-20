/**
 * Bounded same-ID retry queue persisted in sessionStorage.
 *
 * Every participant write is queued BEFORE it is sent. Records are removed
 * only when the server acknowledges the exact same ID, so a reload can retry
 * pending events/audit with identical IDs and content. Same-ID + same-body is
 * idempotent; same-ID + different body is an EVENT_CONFLICT and never
 * overwrites the queued original.
 *
 * Storage is injectable so the queue is testable outside the browser; in the
 * collect bundle it is backed by window.sessionStorage.
 */

import { ContractError } from '@contracts';

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export interface QueuedRecord<T> {
  readonly id: string;
  readonly body: T;
}

/** Compare JSON content independent of object key insertion order. */
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`)
      .join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

const MAX_BOUND = 1000;

export class SameIdRetryQueue<T> {
  private records: QueuedRecord<T>[] = [];

  constructor(
    private readonly storage: StorageLike | null,
    private readonly key: string,
    private readonly capacity: number = 500,
  ) {
    if (capacity < 1 || capacity > MAX_BOUND)
      throw new Error(`retry queue capacity must be within 1..${MAX_BOUND}`);
    this.records = this.load();
  }

  get size(): number {
    return this.records.length;
  }

  /** Records still waiting for a server acknowledgement, in queue order. */
  pending(): ReadonlyArray<QueuedRecord<T>> {
    return this.records.map((r) => ({ id: r.id, body: r.body }));
  }

  has(id: string): boolean {
    return this.records.some((r) => r.id === id);
  }

  /** Queue first, send later: records must survive a page reload. */
  enqueue(id: string, body: T): void {
    const existing = this.records.find((r) => r.id === id);
    if (existing) {
      if (canonicalJson(existing.body) !== canonicalJson(body)) {
        throw new ContractError({
          code: 'EVENT_CONFLICT',
          message: '同一记录 ID 的内容发生变化，已保留最初入队的版本',
          retryable: 'no-retry',
        });
      }
      return;
    }
    if (this.records.length >= this.capacity) {
      throw new ContractError({
        code: 'PERSISTENCE_UNCONFIRMED',
        message: '待确认记录队列已满，请检查网络后刷新重试',
        retryable: 'retry',
      });
    }
    this.records.push({ id, body });
    this.persist();
  }

  /** Remove only IDs the server explicitly acknowledged. */
  remove(ids: Iterable<string>): void {
    const done = new Set(ids);
    const next = this.records.filter((r) => !done.has(r.id));
    if (next.length !== this.records.length) {
      this.records = next;
      this.persist();
    }
  }

  clear(): void {
    this.records = [];
    this.persist();
  }

  private persist(): void {
    if (!this.storage) return;
    if (this.records.length === 0) this.storage.removeItem(this.key);
    else this.storage.setItem(this.key, JSON.stringify(this.records));
  }

  private load(): QueuedRecord<T>[] {
    if (!this.storage) return [];
    try {
      const raw = this.storage.getItem(this.key);
      if (!raw) return [];
      const parsed: unknown = JSON.parse(raw);
      if (!Array.isArray(parsed)) return [];
      return parsed.filter(
        (r): r is QueuedRecord<T> =>
          typeof r === 'object' &&
          r !== null &&
          typeof (r as QueuedRecord<T>).id === 'string' &&
          // body may be any JSON value (tests enqueue primitives); only its
          // presence is required for the record to be replayable.
          'body' in (r as object),
      );
    } catch {
      // Corrupt storage must never block a new session; the server remains
      // the durable authority and idempotent replay makes a fresh queue safe.
      return [];
    }
  }
}
