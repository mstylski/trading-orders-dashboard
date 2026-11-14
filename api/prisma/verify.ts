import assert from 'node:assert/strict';
import { createPrismaClient } from './client';
import { loadFixtures } from './fixtures';

async function main() {
  const expected = loadFixtures();
  const prisma = createPrismaClient();
  try {
    const contracts = await prisma.contractType.findMany();
    const instruments = await prisma.instrument.findMany();
    const orders = await prisma.order.findMany({
      select: {
        id: true,
        displayOrder: true,
        symbol: true,
        side: true,
        size: true,
        openPrice: true,
        openTime: true,
        swap: true,
        instrument: {
          select: { contract: { select: { contractType: true, contractSize: true } } },
        },
      },
    });
    assert.deepEqual([contracts.length, instruments.length, orders.length], [6, 108, 213]);

    for (const row of expected.contracts) {
      const actual = contracts.find((item) => item.contractType === row.contractType);
      assert(actual, `Missing contract type ${row.contractType}`);
      assert(actual.contractSize.equals(row.contractSize), `Contract size ${row.contractType}`);
    }
    for (const row of expected.instruments) {
      assert.deepEqual(
        instruments.find((item) => item.symbol === row.symbol),
        row,
      );
    }
    for (const row of expected.orders) {
      const actual = orders.find((item) => item.id === row.id);
      assert(actual, `Missing order ${row.id}`);
      assert.equal(actual.displayOrder, row.displayOrder, `Order display position ${row.id}`);
      assert.equal(actual.symbol, row.symbol);
      assert.equal(actual.side, row.side);
      assert(actual.size.equals(row.size), `Order size ${row.id}`);
      assert(actual.openPrice.equals(row.openPrice), `Order price ${row.id}`);
      assert(actual.swap.equals(row.swap), `Order swap ${row.id}`);
      assert.equal(actual.openTime.getTime(), row.openTime.getTime(), `Order timestamp ${row.id}`);
      const instrument = expected.instruments.find((item) => item.symbol === row.symbol);
      assert(instrument);
      assert.equal(actual.instrument.contract.contractType, instrument.contractType);
    }

    // PostgreSQL retains microseconds that JavaScript Date would truncate.
    const subMillisecondTimes = await prisma.$queryRaw<{ id: bigint }[]>`
      SELECT id
      FROM public.orders
      WHERE open_time <> date_trunc('milliseconds', open_time)
    `;
    assert.equal(subMillisecondTimes.length, 0, 'Opening times contain sub-millisecond values');

    const joined = await prisma.$queryRaw<{ count: bigint }[]>`
      SELECT count(*) AS count
      FROM orders o
      JOIN instruments i ON i.symbol = o.symbol
      JOIN contract_types c ON c.contract_type = i.contract_type
    `;
    assert.equal(joined[0].count, 213n);
    console.log(
      'PASS: 6 / 108 / 213 records; all decimals, exact timestamps and relations match fixtures.',
    );
    for (const id of [1203384n, 1226230n, 1226260n]) {
      const row = orders.find((item) => item.id === id);
      assert(row);
      console.log(
        `${row.id}: ${row.symbol}, price=${row.openPrice}, swap=${row.swap}, UTC=${row.openTime.toISOString()}, contractSize=${row.instrument.contract.contractSize}`,
      );
    }
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
