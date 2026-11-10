import 'reflect-metadata';
import 'dotenv/config';
import assert from 'node:assert/strict';
import { randomInt, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import process from 'node:process';
import { fileURLToPath, URL } from 'node:url';
import { after, before, describe, it } from 'node:test';
import { NestFactory } from '@nestjs/core';
import { createPrismaClient } from '../../dist/api/prisma/client.js';
import { AppModule } from '../../dist/api/src/app.module.js';

function fixture(name) {
  return JSON.parse(readFileSync(new URL(`../data/${name}`, import.meta.url), 'utf8'));
}

const orders = fixture('order-data.json');
const instruments = fixture('instruments.json');
const contractTypes = fixture('contract-types.json');

function assertLocalDevelopmentDatabase() {
  const message =
    'HTTP integration tests require DATABASE_URL to use PostgreSQL on localhost, 127.0.0.1 or ::1 with database trading_orders_prisma_dev and no connection query overrides; refusing to start the API or modify data.';
  let databaseUrl;
  try {
    databaseUrl = new URL(process.env['DATABASE_URL'] ?? '');
  } catch {
    assert.fail(message);
  }
  assert(
    ['postgres:', 'postgresql:'].includes(databaseUrl.protocol) &&
      ['localhost', '127.0.0.1', '[::1]'].includes(databaseUrl.hostname) &&
      // node-postgres query parameters can override the connection destination.
      !['host', 'connectionString'].some((key) => databaseUrl.searchParams.has(key)) &&
      databaseUrl.pathname === '/trading_orders_prisma_dev',
    message,
  );
}

describe('NestJS HTTP contract (compiled API, seeded PostgreSQL, working directory: dist/api)', () => {
  let app;
  let baseUrl;
  const originalCwd = process.cwd();

  before(
    async () => {
      assertLocalDevelopmentDatabase();
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
