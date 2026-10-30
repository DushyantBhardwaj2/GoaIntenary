import { AsyncLocalStorage } from 'node:async_hooks';
import type { Database, DatabaseRequestScope, SqlClient } from './database.js';

interface QueryResult { rows: Record<string, unknown>[] }
export interface PostgresConnection {
  query(sql: string, values?: unknown[]): Promise<QueryResult>;
  release(destroy?: boolean): void;
  on(event: 'error', listener: () => void): unknown;
  removeListener(event: 'error', listener: () => void): unknown;
}
export interface PostgresPool {
  connect(): Promise<PostgresConnection>;
  query(sql: string, values?: unknown[]): Promise<QueryResult>;
  end(): Promise<void>;
}

/** A request owns its connection until its response is ready, never across requests. */
class RequestConnection {
  private connection?: Promise<PostgresConnection>;
  private pending: Promise<unknown> = Promise.resolve();
  private closed = false;
  private closing?: Promise<void>;
  private unavailable = false;
  private readonly onError = () => { this.unavailable = true; };

  constructor(private readonly pool: PostgresPool) {}

  execute<T>(work: (client: PostgresConnection) => Promise<T>): Promise<T> {
    if (this.closed) return Promise.reject(new Error('Database request scope is closed.'));
    // Queue complete operations, including the entire transaction callback. A
    // parallel standalone query must never run between BEGIN and COMMIT.
    const result = this.pending.then(async () => {
      this.connection ??= this.pool.connect().then(client => {
        // Pool error listeners cover idle clients. While checked out, this
        // listener handles a disconnect between SQL operations safely.
        client.on('error', this.onError);
        return client;
      });
      const client = await this.connection;
      if (this.unavailable) throw new Error('Database connection unavailable.');
      return work(client);
    });
    this.pending = result.catch(() => undefined);
    return result;
  }

  close(): Promise<void> {
    this.closed = true;
    this.closing ??= (async () => {
      // Also covers an abort while pool.connect() or a query is still pending.
      await this.pending;
      const client = await this.connection?.catch(() => undefined);
      if (client) {
        client.removeListener('error', this.onError);
        client.release(true);
      }
    })();
    return this.closing;
  }
}

/** Keep IAM connections only for the current request so Aurora can still pause. */
export function postgresDatabase(pool: PostgresPool, iamAuthentication: boolean): Database {
  const requests = new AsyncLocalStorage<RequestConnection>();
  const transactions = new AsyncLocalStorage<boolean>();

  async function useConnection<T>(work: (client: PostgresConnection) => Promise<T>): Promise<T> {
    if (transactions.getStore()) throw new Error('Use the supplied transaction client inside a transaction.');
    const request = requests.getStore();
    if (request) return request.execute(work);
    const client = await pool.connect();
    try { return await work(client); }
    finally { client.release(iamAuthentication); }
  }

  async function standalone(sql: string, values?: unknown[]): Promise<QueryResult> {
    if (!iamAuthentication && !transactions.getStore()) return pool.query(sql, values);
    return useConnection(client => client.query(sql, values));
  }

  return {
    storage: 'postgres',
    ...(iamAuthentication ? {
      createRequestScope(): DatabaseRequestScope {
        const request = new RequestConnection(pool);
        return { run: work => requests.run(request, work), close: () => request.close() };
      },
    } : {}),
    async query<T>(sql: string, values?: unknown[]) { return (await standalone(sql, values)).rows as T[]; },
    async exec(sql) { await standalone(sql); },
    transaction<T>(work: (client: SqlClient) => Promise<T>): Promise<T> {
      return useConnection(async client => {
        await client.query('BEGIN');
        try {
          const result = await transactions.run(true, () => work({
            async query<R>(sql: string, values?: unknown[]) { return (await client.query(sql, values)).rows as R[]; },
            async exec(sql) { await client.query(sql); },
          }));
          await client.query('COMMIT');
          return result;
        } catch (error) {
          await client.query('ROLLBACK').catch(() => undefined);
          throw error;
        }
      });
    },
    async close() { await pool.end(); },
  };
}
