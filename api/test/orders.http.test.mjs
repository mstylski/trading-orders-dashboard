import 'reflect-metadata';
import 'dotenv/config';
import assert from 'node:assert/strict';
import { createHash, randomInt, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import process from 'node:process';
import { fileURLToPath, URL } from 'node:url';
import { after, before, describe, it } from 'node:test';
import { setTimeout } from 'node:timers/promises';
import { NestFactory } from '@nestjs/core';
import { ApiErrorCode } from '../../dist/api/contracts/api-error-code.js';
import { createPrismaClient } from '../../dist/api/prisma/client.js';
import { AppModule } from '../../dist/api/src/app.module.js';
import { assertLocalTestDatabase } from './support/database-safety.mjs';

function fixture(name) {
  return JSON.parse(readFileSync(new URL(`../data/${name}`, import.meta.url), 'utf8'));
}

const orders = fixture('order-data.json');
const instruments = fixture('instruments.json');
const contractTypes = fixture('contract-types.json');

describe('NestJS HTTP contract (compiled API, seeded PostgreSQL, working directory: dist/api)', () => {
  let app;
  let baseUrl;
  const originalCwd = process.cwd();
  const originalDatabaseUrl = process.env['DATABASE_URL'];

  before(
    async () => {
      const databaseUrl = assertLocalTestDatabase(process.env['TEST_DATABASE_URL']);
      process.env['DATABASE_URL'] = databaseUrl.href;
      // Starting outside the project root guards against paths based on process.cwd().
      process.chdir(fileURLToPath(new URL('../../dist/api/', import.meta.url)));
      app = await NestFactory.create(AppModule, { logger: false, abortOnError: false });
      await app.listen(0, '127.0.0.1');
      baseUrl = await app.getUrl();
    },
    { timeout: 10000 },
  );

  after(async () => {
    try {
      await app?.close();
    } finally {
      process.chdir(originalCwd);
      if (originalDatabaseUrl === undefined) delete process.env['DATABASE_URL'];
      else process.env['DATABASE_URL'] = originalDatabaseUrl;
    }
  });

  async function get(path, expectedStatus = 200) {
    const response = await globalThis.fetch(`${baseUrl}${path}`, {
      signal: globalThis.AbortSignal.timeout(5000),
    });
    assert.equal(response.status, expectedStatus);
    assert.match(response.headers.get('content-type'), /application\/json/);
    return response.json();
  }

  async function post(body, expectedStatus = 201, key = randomUUID()) {
    const response = await globalThis.fetch(`${baseUrl}/orders`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(key === null ? {} : { 'idempotency-key': key }),
      },
      body: JSON.stringify(body),
      signal: globalThis.AbortSignal.timeout(5000),
    });
    assert.equal(response.status, expectedStatus);
    assert.match(response.headers.get('content-type'), /application\/json/);
    return response.json();
  }

  for (const side of ['BUY', 'SELL']) {
    it(`POST /orders persists ${side} with a server-assigned millisecond opening time and returns the GET representation`, async () => {
      const prisma = createPrismaClient();
      // A unique instrument makes cleanup safe even if HTTP fails after committing
      // or a malformed response prevents us from learning the generated order id.
      const symbol = `POST_${randomUUID()}`;
      const input = {
        symbol,
        side,
        size: 1.5,
        openPrice: 67250.25,
      };
      let instrumentCreated = false;
      try {
        await prisma.instrument.create({ data: { symbol, contractType: 0 } });
        instrumentCreated = true;
        const beforeCreation = Date.now();
        const body = await post(input);
        const afterCreation = Date.now();
        assert.deepEqual(Object.keys(body), ['data']);
        const saved = body.data;
        assert.deepEqual(Object.keys(saved).sort(), [
          'id',
          'openPrice',
          'openTime',
          'side',
          'size',
          'swap',
          'symbol',
        ]);
        assert(Number.isSafeInteger(saved.id) && saved.id > 0);
        assert(Number.isSafeInteger(saved.openTime));
        assert(saved.openTime >= beforeCreation && saved.openTime <= afterCreation);
        assert.deepEqual(saved, { ...input, id: saved.id, openTime: saved.openTime, swap: 0 });

        const stored = await prisma.order.findUniqueOrThrow({ where: { id: BigInt(saved.id) } });
        assert.equal(stored.symbol, symbol);
        assert.equal(stored.side, side);
        assert.equal(stored.size.toString(), '1.5');
        assert.equal(stored.openPrice.toString(), '67250.25');
        assert.equal(stored.openTime.getTime(), saved.openTime);
        const [precision] = await prisma.$queryRaw`
          SELECT open_time = date_trunc('milliseconds', open_time) AS milliseconds
          FROM public.orders WHERE id = ${BigInt(saved.id)}
        `;
        assert.equal(precision.milliseconds, true);
        assert.equal(stored.swap.toString(), '0');
        assert.deepEqual(await get('/orders'), { data: [...orders.data, saved] });
        assert.deepEqual(await get('/orders?status=open'), { data: [...orders.data, saved] });
      } finally {
        try {
          if (instrumentCreated) {
            await prisma.order.deleteMany({ where: { symbol } });
            await prisma.instrument.delete({ where: { symbol } });
          }
        } finally {
          await prisma.$disconnect();
        }
      }
      assert.deepEqual(await get('/orders'), orders);
    });
  }

  const validInput = {
    symbol: 'BTCUSD',
    side: 'BUY',
    size: 1.5,
    openPrice: 67250.25,
  };

  for (const key of [null, '', 'not-a-uuid', '12345678-1234-1234-1234-123456789abc']) {
    it(`POST /orders rejects a missing or invalid Idempotency-Key (${key})`, async () => {
      const body = await post(validInput, 400, key);
      assert.equal(body.statusCode, 400);
      assert.match(body.message, /Idempotency-Key/);
      assert.deepEqual(await get('/orders'), orders);
    });
  }

  async function withCreationInstrument(check) {
    const prisma = createPrismaClient();
    const symbol = `IDEMPOTENCY_${randomUUID()}`;
    let created = false;
    try {
      await prisma.instrument.create({ data: { symbol, contractType: 0 } });
      created = true;
      await check(prisma, { ...validInput, symbol });
    } finally {
      try {
        if (created) {
          await prisma.order.deleteMany({ where: { symbol } });
          await prisma.instrument.delete({ where: { symbol } });
        }
      } finally {
        await prisma.$disconnect();
      }
    }
    assert.deepEqual(await get('/orders'), orders);
  }

  it('GET /orders/operations resolves an old five-field operation without changing its hash or inserting an order', async () => {
    await withCreationInstrument(async (prisma, input) => {
      const key = randomUUID();
      const oldInput = { ...input, openTime: Date.parse('2025-01-15T10:20:30.123Z') };
      const oldHash = createHash('sha256').update(JSON.stringify(oldInput)).digest('hex');
      const originalBody = await prisma.$transaction(async (tx) => {
        const order = await tx.order.create({
          data: { ...oldInput, openTime: new Date(oldInput.openTime), swap: 0 },
        });
        const body = { data: { ...oldInput, id: Number(order.id), swap: 0 } };
        await tx.orderCreation.create({
          data: {
            scope: 'POST /orders',
            key,
            requestHash: oldHash,
            orderId: order.id,
            statusCode: 201,
            responseBody: body,
          },
        });
        return body;
      });
      // The old POST format stays forbidden, and stripping its time cannot
      // match the old hash. Resolution only reads the completed registry row.
      await post(oldInput, 400, key);
      const conflict = await post(input, 409, key);
      assert.equal(conflict.code, ApiErrorCode.IdempotencyKeyReused);
      assert.deepEqual(await get(`/orders/operations/${key.toUpperCase()}`, 201), originalBody);
      await setTimeout(20);
      assert.deepEqual(await get(`/orders/operations/${key}`, 201), originalBody);
      assert.equal(await prisma.order.count({ where: { symbol: input.symbol } }), 1);
      assert.equal(await prisma.orderCreation.count({ where: { key } }), 1);
      const saved = await prisma.orderCreation.findUniqueOrThrow({
        where: { scope_key: { scope: 'POST /orders', key } },
      });
      assert.equal(saved.requestHash, oldHash);
      assert.deepEqual(saved.responseBody, originalBody);
    });
  });

  it('GET /orders/operations leaves a missing key unresolved without reserving or inserting', async () => {
    const prisma = createPrismaClient();
    const key = randomUUID();
    try {
      const ordersBefore = await prisma.order.count();
      assert.equal((await get(`/orders/operations/${key}`, 404)).statusCode, 404);
      assert.equal(await prisma.order.count(), ordersBefore);
      assert.equal(await prisma.orderCreation.count({ where: { key } }), 0);
    } finally {
      await prisma.$disconnect();
    }
  });

  it('GET /orders/operations rejects an invalid operation UUID', async () => {
    assert.equal((await get('/orders/operations/not-a-uuid', 400)).statusCode, 400);
  });

  it('POST /orders replays the original status and JSON after a discarded response and NestJS restart', async () => {
    await withCreationInstrument(async (prisma, input) => {
      const key = randomUUID();
      // Consume/discard the successful response without using it to retry.
      await post(input, 201, key);
      const saved = await prisma.orderCreation.findUniqueOrThrow({
        where: { scope_key: { scope: 'POST /orders', key } },
      });
      assert.match(saved.requestHash, /^[0-9a-f]{64}$/);
      assert.equal(
        saved.requestHash,
        createHash('sha256').update(JSON.stringify(input)).digest('hex'),
      );
      assert.equal(saved.statusCode, 201);
      assert.equal(await prisma.order.count({ where: { symbol: input.symbol } }), 1);

      await setTimeout(25);
      assert(Date.now() > saved.responseBody.data.openTime);
      assert.deepEqual(await post(input, 201, key), saved.responseBody);

      // A later order change must not alter the saved creation response.
      await prisma.order.update({ where: { id: saved.orderId }, data: { swap: 10 } });
      await app.close();
      app = await NestFactory.create(AppModule, { logger: false, abortOnError: false });
      await app.listen(0, '127.0.0.1');
      baseUrl = await app.getUrl();
      // Reordered JSON and UUID hex casing describe the same operation.
      const reordered = Object.fromEntries(Object.entries(input).reverse());
      assert.deepEqual(
        await post(reordered, saved.statusCode, key.toUpperCase()),
        saved.responseBody,
      );
      assert.equal(await prisma.order.count({ where: { symbol: input.symbol } }), 1);
      assert.equal(await prisma.orderCreation.count({ where: { key } }), 1);
    });
  });

  it('POST /orders creates exactly one order for several concurrent requests with one key', async () => {
    await withCreationInstrument(async (prisma, input) => {
      const key = randomUUID();
      const settled = await Promise.allSettled(
        Array.from({ length: 6 }, () => post(input, 201, key)),
      );
      // Wait for every request even when one fails, so cleanup cannot race a
      // transaction that is still waiting for its competing reservation.
      const results = settled.map((result) => {
        if (result.status === 'rejected') throw result.reason;
        return result.value;
      });
      for (const result of results) assert.deepEqual(result, results[0]);
      assert.equal(await prisma.order.count({ where: { symbol: input.symbol } }), 1);
      assert.equal(await prisma.orderCreation.count({ where: { key } }), 1);
    });
  });

  it('POST /orders rejects changed DTO fields for an existing key with IDEMPOTENCY_KEY_REUSED', async () => {
    await withCreationInstrument(async (prisma, input) => {
      const key = randomUUID();
      const first = await post(input, 201, key);
      for (const changed of [
        { ...input, symbol: `UNKNOWN_${randomUUID()}` },
        { ...input, side: 'SELL' },
        { ...input, size: 2 },
        { ...input, openPrice: 10 },
      ]) {
        const result = await post(changed, 409, key);
        assert.equal(result.code, ApiErrorCode.IdempotencyKeyReused);
      }
      assert.deepEqual(await post(input, 201, key), first);
      assert.equal(await prisma.order.count({ where: { symbol: input.symbol } }), 1);
      assert.equal(await prisma.orderCreation.count({ where: { key } }), 1);
    });
  });

  it('POST /orders treats different keys with identical data as two separate orders', async () => {
    await withCreationInstrument(async (prisma, input) => {
      const first = await post(input);
      const second = await post(input);
      assert.notEqual(first.data.id, second.data.id);
      assert.equal(await prisma.order.count({ where: { symbol: input.symbol } }), 2);
    });
  });

  it('POST /orders rolls back both the order and reservation on failure before commit, then allows retry', async () => {
    await withCreationInstrument(async (prisma, input) => {
      const key = randomUUID();
      const triggerName = `idempotency_failure_${randomUUID().replaceAll('-', '')}`;
      let functionCreated = false;
      let triggerCreated = false;
      try {
        // Fail precisely when persisting the completed response, after INSERT
        // into orders. Only this test's UUID is affected by the temporary trigger.
        await prisma.$executeRawUnsafe(`
          CREATE FUNCTION public."${triggerName}"() RETURNS trigger LANGUAGE plpgsql AS $$
          BEGIN RAISE EXCEPTION 'forced idempotency persistence failure'; END; $$
        `);
        functionCreated = true;
        await prisma.$executeRawUnsafe(`
          CREATE TRIGGER "${triggerName}" BEFORE UPDATE ON public.order_creations
          FOR EACH ROW WHEN (NEW.key = '${key}'::uuid)
          EXECUTE FUNCTION public."${triggerName}"()
        `);
        triggerCreated = true;
        assert.deepEqual(await post(input, 500, key), {
          statusCode: 500,
          message: 'Internal server error',
        });
        assert.equal(await prisma.order.count({ where: { symbol: input.symbol } }), 0);
        assert.equal(await prisma.orderCreation.count({ where: { key } }), 0);
        await prisma.$executeRawUnsafe(`DROP TRIGGER "${triggerName}" ON public.order_creations`);
        triggerCreated = false;
        const saved = await post(input, 201, key);
        assert.deepEqual(await post(input, 201, key), saved);
        assert.equal(await prisma.order.count({ where: { symbol: input.symbol } }), 1);
        assert.equal(await prisma.orderCreation.count({ where: { key } }), 1);
      } finally {
        if (triggerCreated) {
          await prisma.$executeRawUnsafe(`DROP TRIGGER "${triggerName}" ON public.order_creations`);
        }
        if (functionCreated) {
          await prisma.$executeRawUnsafe(`DROP FUNCTION public."${triggerName}"()`);
        }
      }
    });
  });

  const invalidInputs = [
    ['empty object', {}, 'symbol'],
    ...Object.keys(validInput).map((field) => [
      `missing ${field}`,
      Object.fromEntries(Object.entries(validInput).filter(([key]) => key !== field)),
      field,
    ]),
    ['empty symbol', { ...validInput, symbol: '' }, 'symbol'],
    ['whitespace symbol', { ...validInput, symbol: ' \t\n ' }, 'symbol'],
    ['numeric symbol', { ...validInput, symbol: 123 }, 'symbol'],
    ['null symbol', { ...validInput, symbol: null }, 'symbol'],
    ['invalid side', { ...validInput, side: 'HOLD' }, 'side'],
    ['lowercase side', { ...validInput, side: 'buy' }, 'side'],
    ['null side', { ...validInput, side: null }, 'side'],
    ...['size', 'openPrice'].flatMap((field) =>
      [0, -1, '1.5', null, true, {}, []].map((value) => [
        `${field}=${JSON.stringify(value)}`,
        { ...validInput, [field]: value },
        field,
      ]),
    ),
    ['client id', { ...validInput, id: 123 }, 'id'],
    ...[
      '2025-06-20T16:30:22Z',
      '1750444222123',
      0,
      1750444222123,
      null,
      true,
      {},
      [],
      1.5,
      -62135596800001,
      253402300800000,
    ].map((openTime) => [
      `openTime=${JSON.stringify(openTime)}`,
      { ...validInput, openTime },
      'openTime',
    ]),
    ['client swap', { ...validInput, swap: 0 }, 'swap'],
    ['unknown field', { ...validInput, extra: 'value' }, 'extra'],
  ];

  for (const [label, input, field] of invalidInputs) {
    it(`POST /orders rejects ${label} with 400 without writing an order`, async () => {
      const body = await post(input, 400);
      assert.equal(body.statusCode, 400);
      assert.equal(body.error, 'Bad Request');
      assert(Array.isArray(body.message) && body.message.length > 0);
      assert(body.message.some((message) => message.includes(field)));
      assert.deepEqual(Object.keys(body).sort(), ['error', 'message', 'statusCode']);
      assert.deepEqual(await get('/orders'), orders);
    });
  }

  it('POST /orders rejects client-assigned id or openTime before reserving the key', async () => {
    const prisma = createPrismaClient();
    try {
      for (const supplied of [{ id: 123 }, { openTime: 0 }]) {
        const key = randomUUID();
        await post({ ...validInput, ...supplied }, 400, key);
        assert.equal(await prisma.orderCreation.count({ where: { key } }), 0);
      }
      assert.deepEqual(await get('/orders'), orders);
    } finally {
      await prisma.$disconnect();
    }
  });

  it('POST /orders rejects a valid request for an unknown instrument with 404', async () => {
    assert.deepEqual(await post({ ...validInput, symbol: `UNKNOWN_${randomUUID()}` }, 404), {
      statusCode: 404,
      message: 'Instrument not found',
      error: 'Not Found',
    });
    assert.deepEqual(await get('/orders'), orders);
  });

  for (const query of ['', '?status=open', '?status=OPEN']) {
    it(`GET /orders${query} returns the complete orders envelope`, async () => {
      const body = await get(`/orders${query}`);
      assert.deepEqual(body, orders);
      assert.equal(body.data.length, 213);
      assert.deepEqual(body.data[0], {
        openTime: 1750740422000,
        openPrice: 104837.47,
        swap: -0.00147939,
        id: 1203384,
        symbol: 'BTCUSD',
        side: 'BUY',
        size: 0.05,
      });
    });
  }

  it('GET /orders?status=closed returns an empty orders envelope', async () => {
    assert.deepEqual(await get('/orders?status=closed'), { data: [] });
  });

  for (const query of ['status=invalid', 'status=', 'status=open&status=closed']) {
    it(`rejects ${query} with 400 and continues serving valid requests`, async () => {
      assert.deepEqual(await get(`/orders?${query}`, 400), {
        statusCode: 400,
        message: 'status must be open or closed',
        error: 'Bad Request',
      });
      assert.deepEqual(await get('/orders?status=open'), orders);
    });
  }

  async function withTemporaryOrder(overrides, check) {
    const prisma = createPrismaClient();
    const row = {
      id: BigInt(randomInt(1_000_000_000, 2_000_000_000)),
      symbol: 'BTCUSD',
      side: 'SELL',
      size: '0.125',
      openPrice: '12345.67890123',
      openTime: '2026-11-10T12:34:56.789+02:00',
      swap: '-0.00000001',
      ...overrides,
    };
    let created = false;
    try {
      // Use SQL so NUMERIC and TIMESTAMPTZ values never pass through Number/Date
      // before PostgreSQL stores them, including the precision regression cases.
      await prisma.$executeRaw`
        INSERT INTO orders (id, symbol, side, size, open_price, open_time, swap)
        VALUES (${row.id}, ${row.symbol}, ${row.side}, ${row.size}::numeric,
                ${row.openPrice}::numeric, ${row.openTime}::timestamptz, ${row.swap}::numeric)
      `;
      created = true;
      await check(row, prisma);
    } finally {
      try {
        if (created) await prisma.order.delete({ where: { id: row.id } });
        assert.equal(await prisma.order.count(), 213, 'Temporary order must be removed');
      } finally {
        await prisma.$disconnect();
      }
    }
    assert.deepEqual(await get('/orders'), orders);
  }

  it('GET /orders reads a direct SQL insert with exact BigInt, Decimal and timezone values', async () => {
    await withTemporaryOrder({ id: BigInt(Number.MAX_SAFE_INTEGER) }, async (row, prisma) => {
      const expected = {
        id: Number.MAX_SAFE_INTEGER,
        symbol: row.symbol,
        side: row.side,
        size: 0.125,
        openPrice: 12345.67890123,
        openTime: Date.parse('2026-11-10T10:34:56.789Z'),
        swap: -0.00000001,
      };
      for (const query of ['', '?status=open', '?status=OPEN']) {
        const body = await get(`/orders${query}`);
        assert.equal(body.data.length, 214);
        // Unranked database rows follow the original complete snapshot. The
        // internal ordering column and status must never leak into the JSON.
        assert.deepEqual(body, { data: [...orders.data, expected] });
      }
      assert.deepEqual(await get('/orders?status=closed'), { data: [] });
      assert.deepEqual(await get('/instruments'), instruments);
      assert.deepEqual(await get('/contract-types'), contractTypes);

      await prisma.$executeRaw`UPDATE orders SET swap = 0 WHERE id = ${row.id}`;
      assert.deepEqual(await get('/orders'), {
        data: [...orders.data, { ...expected, swap: 0 }],
      });
    });
  });

  for (const id of [9007199254740992n, 9007199254740993n]) {
    it(`GET /orders rejects BigInt ${id} outside the safe JavaScript integer range`, async () => {
      await withTemporaryOrder({ id }, async () => {
        assert.deepEqual(await get('/orders', 500), {
          statusCode: 500,
          message: 'Internal server error',
        });
      });
    });
  }

  for (const field of ['size', 'openPrice', 'swap']) {
    for (const [value, reason] of [
      ['1e400', 'overflows to Infinity'],
      ['1e-400', 'underflows to zero'],
      ['9007199254740993', 'loses integer precision'],
      ['0.123456789012345678901', 'loses fractional precision'],
    ]) {
      it(`GET /orders rejects ${field} that ${reason}`, async () => {
        await withTemporaryOrder({ [field]: value }, async () => {
          assert.deepEqual(await get('/orders', 500), {
            statusCode: 500,
            message: 'Internal server error',
          });
          assert.deepEqual(await get('/orders?status=closed'), { data: [] });
        });
      });
    }
  }

  it('GET /orders rejects negative swap precision loss', async () => {
    await withTemporaryOrder({ swap: '-9007199254740993' }, async () => {
      assert.deepEqual(await get('/orders', 500), {
        statusCode: 500,
        message: 'Internal server error',
      });
    });
  });

  it('GET /orders rejects microseconds that Prisma Date would silently truncate', async () => {
    await withTemporaryOrder({ openTime: '2026-11-10T12:34:56.789123+02:00' }, async () => {
      assert.deepEqual(await get('/orders', 500), {
        statusCode: 500,
        message: 'Internal server error',
      });
      assert.deepEqual(await get('/orders?status=closed'), { data: [] });
    });
  });

  it('GET /instruments returns all 108 seeded instruments in the original JSON format', async () => {
    const body = await get('/instruments');
    assert.deepEqual(body, instruments);
    assert.equal(body.length, 108);
    assert.deepEqual(body[0], { symbol: 'AAPL.US', contractType: 0 });
    for (const instrument of [
      { symbol: 'BTCUSD', contractType: 0 },
      { symbol: 'VIX', contractType: 1 },
      { symbol: 'ARBUSD', contractType: 3 },
      { symbol: 'ADAUSD', contractType: 4 },
      { symbol: 'USDPLN', contractType: 5 },
    ]) {
      assert.deepEqual(
        body.find(({ symbol }) => symbol === instrument.symbol),
        instrument,
      );
    }
  });

  it('GET /instruments reads current PostgreSQL rows instead of the JSON fixture', async () => {
    const prisma = createPrismaClient();
    const instrument = { symbol: `INTEGRATION_${randomUUID()}`, contractType: 0 };
    let created = false;

    try {
      await prisma.instrument.create({ data: instrument });
      created = true;

      const body = await get('/instruments');
      assert.equal(body.length, 109);
      assert.deepEqual(
        body.find(({ symbol }) => symbol === instrument.symbol),
        instrument,
      );
      assert.deepEqual(
        body.filter(({ symbol }) => symbol !== instrument.symbol),
        instruments,
      );
      assert.deepEqual(await get('/orders'), orders);
      assert.deepEqual(await get('/contract-types'), contractTypes);
    } finally {
      try {
        if (created) await prisma.instrument.delete({ where: { symbol: instrument.symbol } });
      } finally {
        await prisma.$disconnect();
      }
    }

    assert.deepEqual(await get('/instruments'), instruments);
  });

  it('GET /contract-types preserves all six fixture sizes as finite numbers in contractType order', async () => {
    const body = await get('/contract-types');
    assert.deepEqual(body, contractTypes);
    assert.equal(body.length, 6);
    assert.deepEqual(
      body.map(({ contractType }) => contractType),
      [0, 1, 2, 3, 4, 5],
    );
    for (const [index, row] of body.entries()) {
      assert.deepEqual(Object.keys(row).sort(), ['contractSize', 'contractType']);
      assert.equal(typeof row.contractSize, 'number');
      assert(Number.isFinite(row.contractSize));
      assert.equal(row.contractSize, contractTypes[index].contractSize);
    }
    assert.deepEqual(await get('/contract-types'), body);
  });

  it('GET /contract-types reads a temporary PostgreSQL Decimal and cleans up to six records', async () => {
    const prisma = createPrismaClient();
    const contractType = randomInt(6, 32768);
    const expected = { contractType, contractSize: 0.125 };
    let created = false;

    try {
      await prisma.contractType.create({ data: { contractType, contractSize: '0.125' } });
      created = true;

      const body = await get('/contract-types');
      assert.equal(body.length, 7);
      assert.deepEqual(body, [...contractTypes, expected]);
      assert.equal(typeof body[6].contractSize, 'number');
      assert(Number.isFinite(body[6].contractSize));
      assert.deepEqual(await get('/contract-types'), body);
      assert.deepEqual(await get('/orders'), orders);
      assert.deepEqual(await get('/instruments'), instruments);
    } finally {
      try {
        if (created) await prisma.contractType.delete({ where: { contractType } });
        assert.equal(await prisma.contractType.count(), 6);
      } finally {
        await prisma.$disconnect();
      }
    }

    assert.deepEqual(await get('/contract-types'), contractTypes);
  });

  for (const [contractSize, reason] of [
    ['1e400', 'overflows to Infinity'],
    ['1e-400', 'underflows to zero'],
    ['9007199254740993', 'loses integer precision'],
  ]) {
    it(`GET /contract-types rejects a Decimal that ${reason}`, async () => {
      const prisma = createPrismaClient();
      const contractType = randomInt(6, 32768);
      let created = false;

      try {
        // PostgreSQL NUMERIC preserves these values; JavaScript Number cannot.
        await prisma.contractType.create({ data: { contractType, contractSize } });
        created = true;

        assert.deepEqual(await get('/contract-types', 500), {
          statusCode: 500,
          message: 'Internal server error',
        });
        assert.deepEqual(await get('/orders'), orders);
      } finally {
        try {
          if (created) await prisma.contractType.delete({ where: { contractType } });
          assert.equal(await prisma.contractType.count(), 6);
        } finally {
          await prisma.$disconnect();
        }
      }

      assert.deepEqual(await get('/contract-types'), contractTypes);
    });
  }
});
