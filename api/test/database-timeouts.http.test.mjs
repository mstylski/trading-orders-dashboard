import 'dotenv/config';
import assert from 'node:assert/strict';
import { fork } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { performance } from 'node:perf_hooks';
import process from 'node:process';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath, URL } from 'node:url';
import { describe, it } from 'node:test';
import pg from 'pg';
import { DATABASE_TIMEOUTS } from '../../dist/api/prisma/client.js';

const { connectionTimeoutMillis, statement_timeout: statementTimeout } = DATABASE_TIMEOUTS;
// CI scheduling/HTTP overhead is separate from the configured database deadlines.
const margin = 1500;
const requestDeadline = connectionTimeoutMillis + statementTimeout + margin;
const fixtures = (name) =>
  JSON.parse(readFileSync(new URL(`../data/${name}`, import.meta.url), 'utf8'));
const instruments = fixtures('instruments.json');
const orders = fixtures('order-data.json');

async function within(promise, milliseconds, label) {
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = globalThis.setTimeout(
          () => reject(new Error(`${label} exceeded ${milliseconds} ms`)),
          milliseconds,
        );
      }),
    ]);
  } finally {
    globalThis.clearTimeout(timer);
  }
}

async function until(predicate, milliseconds, label) {
  const start = performance.now();
  while (!(await predicate())) {
    assert(performance.now() - start < milliseconds, `${label} exceeded ${milliseconds} ms`);
    await delay(20);
  }
}

async function listen(server) {
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  return server.address().port;
}

async function closeServer(server, sockets = new Set()) {
  for (const socket of sockets) socket.destroy();
  await within(new Promise((resolve) => server.close(resolve)), margin, 'TCP server cleanup');
}

async function startApi(databaseUrl) {
  const child = fork(fileURLToPath(new URL('./support/api-process.mjs', import.meta.url)), [], {
    cwd: fileURLToPath(new URL('../../dist/api/', import.meta.url)),
    env: { ...process.env, DATABASE_URL: databaseUrl },
    stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
  });
  const exited = new Promise((resolve) =>
    child.once('exit', (code, signal) => resolve({ code, signal })),
  );
  const ready = new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('exit', () => reject(new Error('Test API exited before listening')));
    child.once('message', (message) => {
      if (message.type === 'ready') resolve(message.baseUrl);
      else reject(new Error('Unexpected API startup response'));
    });
  });
  let closed = false;
  try {
    const baseUrl = await within(ready, 10000, 'Test API startup');
    return {
      baseUrl,
      async close(deadline = connectionTimeoutMillis + margin) {
        if (closed) return;
        closed = true;
        try {
          child.send('close');
          const result = await within(exited, deadline, 'Graceful API process exit');
          assert.deepEqual(result, { code: 0, signal: null });
        } finally {
          // A failed assertion must never leave the regression test's process alive.
          if (child.exitCode === null && child.signalCode === null) {
            child.kill('SIGKILL');
            await within(exited, margin, 'Forced test process cleanup');
          }
        }
      },
    };
  } catch (error) {
    child.kill('SIGKILL');
    await within(exited, margin, 'Failed startup cleanup');
    throw error;
  }
}

async function get(baseUrl, path, signal = globalThis.AbortSignal.timeout(requestDeadline)) {
  // Isolate database shutdown from HTTP's separate keep-alive idle timeout.
  const response = await globalThis.fetch(`${baseUrl}${path}`, {
    signal,
    headers: { connection: 'close' },
  });
  return { status: response.status, body: await response.json() };
}

function assertDatabaseFailure(response) {
  assert.equal(response.status, 500);
  assert.deepEqual(response.body, { statusCode: 500, message: 'Internal server error' });
}

describe('Database deadlines (real TCP server, real PostgreSQL and real NestJS processes)', () => {
  it(
    'bounds silent handshake, cleans sockets after HTTP abort, and closes during a pending connection',
    { timeout: 20000 },
    async () => {
      const sockets = new Set();
      const tcp = createServer((socket) => {
        sockets.add(socket);
        socket.on('data', () => {}); // Accept/read startup packets, deliberately never answer.
        socket.on('error', () => {});
        socket.once('close', () => sockets.delete(socket));
      });
      const port = await listen(tcp);
      let api;
      try {
        api = await startApi(
          `postgresql://test:test@127.0.0.1:${port}/handshake_test?sslmode=disable`,
        );
        const started = performance.now();
        assertDatabaseFailure(await get(api.baseUrl, '/instruments'));
        assert(performance.now() - started < connectionTimeoutMillis + margin);
        await until(() => sockets.size === 0, margin, 'Timed-out handshake socket cleanup');

        const controller = new globalThis.AbortController();
        const aborted = get(api.baseUrl, '/instruments', controller.signal).catch((error) => error);
        await until(() => sockets.size === 1, margin, 'Second handshake start');
        controller.abort();
        assert((await aborted) instanceof Error);
        await until(
          () => sockets.size === 0,
          connectionTimeoutMillis + margin,
          'Handshake cleanup after HTTP abort',
        );

        const pending = get(api.baseUrl, '/instruments').catch((error) => error);
        await until(() => sockets.size === 1, margin, 'Pending handshake before shutdown');
        await api.close();
        await pending;
        await until(() => sockets.size === 0, margin, 'Handshake socket cleanup on shutdown');
      } finally {
        try {
          await api?.close();
        } finally {
          await closeServer(tcp, sockets);
        }
      }
    },
  );

  it(
    'returns generic 5xx for both PostgreSQL routes and keeps fixture-backed orders working',
    { timeout: 15000 },
    async () => {
      // Allocate/release a loopback port; never stop or reconfigure the real database.
      const tcp = createServer();
      const port = await listen(tcp);
      await closeServer(tcp);
      const api = await startApi(
        `postgresql://test:test@127.0.0.1:${port}/unavailable_test?sslmode=disable`,
      );
      try {
        assertDatabaseFailure(await get(api.baseUrl, '/instruments'));
        assertDatabaseFailure(await get(api.baseUrl, '/contract-types'));
        assert.deepEqual(await get(api.baseUrl, '/orders'), { status: 200, body: orders });
      } finally {
        await api.close();
      }
    },
  );

  it(
    'PostgreSQL cancels a lock-blocked SELECT, also after HTTP abort, then returns all 108 instruments',
    { timeout: 25000 },
    async () => {
      const databaseUrl = new URL(process.env['DATABASE_URL']);
      // This test takes an exclusive lock; allow only the documented, local dev DB.
      assert(['localhost', '127.0.0.1', '[::1]'].includes(databaseUrl.hostname));
      assert.equal(databaseUrl.pathname, '/trading_orders_prisma_dev');
      assert(
        !['host', 'connectionString'].some((key) => databaseUrl.searchParams.has(key)),
        'The lock test forbids DATABASE_URL query parameters that override the connection destination.',
      );
      const applicationName = `instruments_timeout_${randomUUID()}`;
      databaseUrl.searchParams.set('application_name', applicationName);
      const blocker = new pg.Client({
        connectionString: process.env['DATABASE_URL'],
        connectionTimeoutMillis,
        statement_timeout: requestDeadline,
        query_timeout: requestDeadline + margin,
      });
      let api;
      let inTransaction = false;
      try {
        await blocker.connect();
        api = await startApi(databaseUrl.href);
        assert.deepEqual(await get(api.baseUrl, '/instruments'), {
          status: 200,
          body: instruments,
        });
        await blocker.query('BEGIN');
        inTransaction = true;
        await blocker.query('LOCK TABLE instruments IN ACCESS EXCLUSIVE MODE');

        const started = performance.now();
        assertDatabaseFailure(await get(api.baseUrl, '/instruments'));
        assert(performance.now() - started >= statementTimeout - 200);
        assert(performance.now() - started < statementTimeout + margin);
        const activeCount = async () => {
          // Statistics can otherwise retain the transaction's first snapshot.
          await blocker.query('SELECT pg_stat_clear_snapshot()');
          const result = await blocker.query(
            "SELECT count(*)::int AS count FROM pg_stat_activity WHERE application_name = $1 AND state = 'active'",
            [applicationName],
          );
          return result.rows[0].count;
        };
        assert.equal(await activeCount(), 0, 'SQL must finish while the lock is still held');

        const controller = new globalThis.AbortController();
        const aborted = get(api.baseUrl, '/instruments', controller.signal).catch((error) => error);
        await until(async () => (await activeCount()) > 0, margin, 'Lock-blocked query start');
        controller.abort();
        assert((await aborted) instanceof Error);
        await until(
          async () => (await activeCount()) === 0,
          statementTimeout + margin,
          'Server-side SQL cancellation after HTTP abort',
        );

        await blocker.query('ROLLBACK');
        inTransaction = false;
        assert.deepEqual(await get(api.baseUrl, '/instruments'), {
          status: 200,
          body: instruments,
        });
        assert.equal(instruments.length, 108);
      } finally {
        try {
          if (inTransaction) await blocker.query('ROLLBACK');
        } finally {
          try {
            await blocker.end();
          } finally {
            await api?.close();
          }
        }
      }
    },
  );
});
