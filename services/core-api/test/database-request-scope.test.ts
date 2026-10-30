import assert from 'node:assert/strict';
import { test } from 'node:test';
import { EventEmitter } from 'node:events';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import { postgresDatabase, type PostgresConnection, type PostgresPool } from '../src/postgres-database.js';

function deferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}

class FakePool implements PostgresPool {
  readonly connections: { queries: string[]; releases: (boolean | undefined)[]; events: EventEmitter }[] = [];
  closed = false;
  connectError?: Error;
  connectGate?: Promise<void>;
  queryHook?: (sql: string, index: number) => Promise<void>;

  async connect(): Promise<PostgresConnection> {
    await this.connectGate;
    if (this.connectError) throw this.connectError;
    const index = this.connections.length;
    const state = { queries: [] as string[], releases: [] as (boolean | undefined)[], events: new EventEmitter() };
    this.connections.push(state);
    return {
      query: async (sql, values) => {
        assert.equal(state.releases.length, 0, 'released connections must never be reused');
        state.queries.push(sql);
        await this.queryHook?.(sql, index);
        if (sql.includes('goa_core_rate_limits') && sql.includes('RETURNING hits')) return { rows: [{ hits: 1 }] };
        if (sql.includes('INSERT INTO goa_core_profiles')) return { rows: [{ id: values![0], display_name: 'Aman', email: null }] };
        if (sql.includes('goa_core_migrations')) return { rows: [{ version: 5 }] };
        return { rows: [] };
      },
      release: destroy => { state.releases.push(destroy); },
      on: (event, listener) => state.events.on(event, listener),
      removeListener: (event, listener) => state.events.removeListener(event, listener),
    };
  }

  async query(sql: string, values?: unknown[]) {
    const client = await this.connect();
    try { return await client.query(sql, values); }
    finally { client.release(); }
  }
  async end() { this.closed = true; }
}

test('IAM request scopes acquire lazily, reuse one connection and destroy it once before closing', async () => {
  const pool = new FakePool(), database = postgresDatabase(pool, true);
  const scope = database.createRequestScope!();
  assert.equal(pool.connections.length, 0);
  await scope.run(async () => {
    await database.query('rate-limit');
    await database.query('profile');
    await database.transaction(async client => { await client.query('trip'); });
  });
  assert.equal(pool.connections.length, 1);
  assert.deepEqual(pool.connections[0]!.queries, ['rate-limit', 'profile', 'BEGIN', 'trip', 'COMMIT']);
  assert.deepEqual(pool.connections[0]!.releases, []);
  await Promise.all([scope.close(), scope.close()]);
  assert.deepEqual(pool.connections[0]!.releases, [true]);
  await assert.rejects(scope.run(() => database.query('too late')), /scope is closed/);
  await database.close();
  assert.equal(pool.closed, true);
});

test('overlapping requests use separate connections without leaking their async context', async () => {
  const pool = new FakePool(), database = postgresDatabase(pool, true);
  const first = database.createRequestScope!(), second = database.createRequestScope!();
  const started = deferred(), resume = deferred();
  const firstWork = first.run(async () => {
    await database.query('first-before');
    started.resolve();
    await resume.promise;
    await database.query('first-after');
  });
  await started.promise;
  await second.run(async () => { await database.query('second'); });
  await second.close();
  resume.resolve();
  await firstWork;
  await first.close();
  assert.deepEqual(pool.connections.map(connection => connection.queries), [['first-before', 'first-after'], ['second']]);
  assert.deepEqual(pool.connections.map(connection => connection.releases), [[true], [true]]);
  await database.query('outside-request');
  assert.equal(pool.connections.length, 3);
  assert.deepEqual(pool.connections[2]!.releases, [true]);
});

test('parallel operations inside one request cannot interleave with a transaction', async () => {
  const pool = new FakePool(), database = postgresDatabase(pool, true);
  const scope = database.createRequestScope!(), started = deferred(), resume = deferred();
  await scope.run(async () => {
    const transaction = database.transaction(async client => {
      await client.query('inside-before');
      started.resolve();
      await resume.promise;
      await client.query('inside-after');
    });
    await started.promise;
    const outside = database.query('outside');
    resume.resolve();
    await Promise.all([transaction, outside]);
  });
  await scope.close();
  assert.deepEqual(pool.connections[0]!.queries, ['BEGIN', 'inside-before', 'inside-after', 'COMMIT', 'outside']);
});

test('transaction failure rolls back and cleanup survives rollback errors', async () => {
  const pool = new FakePool(), database = postgresDatabase(pool, true);
  const scope = database.createRequestScope!();
  pool.queryHook = async sql => { if (sql === 'ROLLBACK') throw new Error('rollback unavailable'); };
  await scope.run(async () => {
    await assert.rejects(database.transaction(async client => {
      await client.query('write');
      throw new Error('operation failed');
    }), /operation failed/);
  });
  await scope.close();
  assert.deepEqual(pool.connections[0]!.queries, ['BEGIN', 'write', 'ROLLBACK']);
  assert.deepEqual(pool.connections[0]!.releases, [true]);
});

test('synchronous scope failure and failed acquisition clean up without reconnecting', async () => {
  const pool = new FakePool(), database = postgresDatabase(pool, true);
  const empty = database.createRequestScope!();
  assert.throws(() => empty.run(() => { throw new Error('synchronous'); }), /synchronous/);
  await empty.close();
  assert.equal(pool.connections.length, 0);
  pool.connectError = new Error('unavailable');
  const failed = database.createRequestScope!();
  await assert.rejects(failed.run(() => database.query('read')), /unavailable/);
  await failed.close();
  await failed.close();
  assert.equal(pool.connections.length, 0);
});

test('closing during pending connection acquisition destroys the eventual connection and blocks new SQL', async () => {
  const pool = new FakePool(), database = postgresDatabase(pool, true), gate = deferred();
  pool.connectGate = gate.promise;
  const scope = database.createRequestScope!();
  const query = scope.run(() => database.query('already queued'));
  const closing = scope.close();
  await assert.rejects(scope.run(() => database.query('after abort')), /scope is closed/);
  gate.resolve();
  await Promise.all([query, closing]);
  assert.deepEqual(pool.connections[0]!.queries, ['already queued']);
  assert.deepEqual(pool.connections[0]!.releases, [true]);
});

test('transaction callbacks cannot deadlock by using database instead of their supplied client', async () => {
  const pool = new FakePool(), database = postgresDatabase(pool, true);
  const scope = database.createRequestScope!();
  await assert.rejects(scope.run(() => database.transaction(async () => { await database.query('incorrect client'); })), /supplied transaction client/);
  await scope.close();
  assert.deepEqual(pool.connections[0]!.queries, ['BEGIN', 'ROLLBACK']);
});

test('checked-out connection errors between queries are handled and the client is destroyed', async () => {
  const pool = new FakePool(), database = postgresDatabase(pool, true);
  const scope = database.createRequestScope!();
  await scope.run(async () => {
    await database.query('before disconnect');
    pool.connections[0]!.events.emit('error', new Error('private provider details'));
    await assert.rejects(database.query('after disconnect'), /^Error: Database connection unavailable\.$/);
  });
  await scope.close();
  assert.deepEqual(pool.connections[0]!.queries, ['before disconnect']);
  assert.deepEqual(pool.connections[0]!.releases, [true]);
  assert.equal(pool.connections[0]!.events.listenerCount('error'), 0);
});

test('non-request IAM work retains close-per-operation and transactions release on failure', async () => {
  const pool = new FakePool(), database = postgresDatabase(pool, true);
  await database.query('migration read');
  await assert.rejects(database.transaction(async client => { await client.query('migration'); throw new Error('failed'); }), /failed/);
  assert.deepEqual(pool.connections.map(connection => connection.queries), [['migration read'], ['BEGIN', 'migration', 'ROLLBACK']]);
  assert.deepEqual(pool.connections.map(connection => connection.releases), [[true], [true]]);
});

test('Fastify reuses one connection through authentication and destroys it for success and errors', async () => {
  const pool = new FakePool(), database = postgresDatabase(pool, true);
  const config = loadConfig({ NODE_ENV: 'test', ENABLE_LOCAL_DEMO: 'true', LOCAL_SESSION_SECRET: 'synthetic-test-secret-at-least-32-bytes-long' });
  let authentications = 0;
  const app = await buildApp({ config, database, runMigrations: false, logger: false, authenticate: async token => {
    authentications++;
    if (token === 'denied') throw new Error('authentication unavailable');
    return { id: '10000000-0000-4000-8000-000000000001', displayName: 'Aman' };
  } });
  try {
    const headers = { authorization: 'Bearer allowed' };
    const success = await app.inject({ url: '/v1/trips', headers });
    assert.equal(success.statusCode, 200);
    assert.deepEqual(success.json(), { trips: [] });
    assert.equal(pool.connections.length, 1, 'rate-limit, profile, pruning and route share one connection');
    assert.deepEqual(pool.connections[0]!.releases, [true], 'connection is destroyed before response is observed');
    assert.equal((await app.inject({ url: '/v1/trips' })).statusCode, 401);
    assert.equal((await app.inject({ url: '/v1/trips', headers: { authorization: 'Bearer denied' } })).statusCode, 503);
    assert.equal((await app.inject({ url: '/v1/trips', method: 'POST', headers, payload: {} })).statusCode, 400);
    pool.queryHook = async sql => { if (sql.includes('FROM goa_core_trips')) throw new Error('database unavailable'); };
    assert.equal((await app.inject({ url: '/v1/trips', headers })).statusCode, 503);
    assert.equal(authentications, 4, 'authentication still occurs for every authenticated request');
    assert.equal(pool.connections.length, 5);
    assert.ok(pool.connections.every(connection => connection.releases.length === 1 && connection.releases[0] === true));
    pool.queryHook = undefined;
    const concurrent = await Promise.all([app.inject({ url: '/v1/trips', headers }), app.inject({ url: '/v1/trips', headers })]);
    assert.deepEqual(concurrent.map(response => response.statusCode), [200, 200]);
    assert.equal(authentications, 6);
    assert.equal(pool.connections.length, 7, 'overlapping HTTP requests own separate connections');
    assert.ok(pool.connections.slice(5).every(connection => connection.queries.filter(sql => sql.includes('INSERT INTO goa_core_profiles')).length === 1));
    assert.ok(pool.connections.every(connection => connection.releases.length === 1 && connection.releases[0] === true));
  } finally { await app.close(); await database.close(); }
});
