import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse } from 'lossless-json';
import { Prisma } from './generated/client';

interface ContractFixture {
  contractType: string;
  contractSize: string;
}

interface InstrumentFixture {
  symbol: string;
  contractType: string;
}

interface OrderFixture {
  id: string;
  symbol: string;
  side: string;
  size: string;
  openPrice: string;
  openTime: string;
  swap: string;
}

function fixture<T>(name: string): T {
  // The parser passes the original numeric token (including exponent notation)
  // directly to this callback; decimals never pass through a JS number.
  return parse(
    readFileSync(join(__dirname, '../data', name), 'utf8'),
    undefined,
    (token) => token,
  ) as T;
}

function safeInteger(token: string): number {
  const value = Number(token);
  assert(Number.isSafeInteger(value), `Expected a safe integer, received ${token}`);
  return value;
}

export function loadFixtures() {
  const contracts = fixture<ContractFixture[]>('contract-types.json').map((row) => ({
    contractType: safeInteger(row.contractType),
    contractSize: new Prisma.Decimal(row.contractSize),
  }));
  const instruments = fixture<InstrumentFixture[]>('instruments.json').map((row) => ({
    symbol: row.symbol,
    contractType: safeInteger(row.contractType),
  }));
  const orders = fixture<{ data: OrderFixture[] }>('order-data.json').data.map((row) => {
    const milliseconds = safeInteger(row.openTime);
    const openTime = new Date(milliseconds);
    assert.equal(openTime.getTime(), milliseconds, `Invalid openTime for order ${row.id}`);
    return {
      id: BigInt(row.id),
      symbol: row.symbol,
      side: row.side,
      size: new Prisma.Decimal(row.size),
      openPrice: new Prisma.Decimal(row.openPrice),
      openTime,
      swap: new Prisma.Decimal(row.swap),
    };
  });

  // Validate the snapshot before the seed starts replacing any database rows.
  assert.deepEqual([contracts.length, instruments.length, orders.length], [6, 108, 213]);
  assert.equal(new Set(contracts.map((row) => row.contractType)).size, contracts.length);
  assert.equal(new Set(instruments.map((row) => row.symbol)).size, instruments.length);
  assert.equal(new Set(orders.map((row) => row.id)).size, orders.length);
  return { contracts, instruments, orders };
}
