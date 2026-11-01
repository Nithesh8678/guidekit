import { AsyncLocalStorage } from 'node:async_hooks';

export type SQLValue = string | number | null;
export type SQLRow = Record<string, string | number | null>;
export interface SQLResult { changes: number }
export interface SQLStatement {
  run(...values: SQLValue[]): Promise<SQLResult>;
  get(...values: SQLValue[]): Promise<SQLRow | undefined>;
  all(...values: SQLValue[]): Promise<SQLRow[]>;
}
export interface SQLDriver {
  readonly dialect: 'sqlite' | 'postgres';
  prepare(sql: string): SQLStatement;
  exec(sql: string): Promise<void>;
  transaction<T>(fn: () => Promise<T>): Promise<T>;
  close(): Promise<void>;
}

/** A mutex is held for the complete async SQLite transaction, not one statement. */
export class Mutex {
  private tail: Promise<void> = Promise.resolve();
  async run<T>(fn: () => Promise<T>): Promise<T> {
    let release!: () => void;
    const previous = this.tail;
    this.tail = new Promise<void>(resolve => { release = resolve; });
    await previous;
    try { return await fn(); } finally { release(); }
  }
}
export interface TransactionContext<T> { resource: T; active: boolean; savepoint: number }
export const transactionStorage = <T>() => new AsyncLocalStorage<TransactionContext<T>>();
