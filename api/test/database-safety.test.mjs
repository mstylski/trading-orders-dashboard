import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { assertLocalTestDatabase } from './support/database-safety.mjs';

const localUrl = 'postgresql://test:secret@127.0.0.1:5432/trading_orders_test';

describe('Integration database safety (no database connection)', () => {
  for (const host of ['localhost', '127.0.0.1', '[::1]']) {
    it(`accepts only the documented database on ${host}`, () => {
      const url = `postgres://test:secret@${host}:5432/trading_orders_test?sslmode=disable&application_name=integration`;
      assert.equal(assertLocalTestDatabase(url).href, url);
    });
  }

  for (const query of [
    'database=trading_orders',
    'database=trading_orders_test',
    'database=',
    '%64atabase=trading_orders',
    'database=trading_orders_test&database=trading_orders',
    'host=remote.example',
    'port=5433',
    'connectionString=postgresql%3A%2F%2Fremote.example%2Ftrading_orders',
  ]) {
    it(`rejects connection query override ${query} before any connection`, () => {
      assert.throws(
        () => assertLocalTestDatabase(`${localUrl}?${query}`),
        /refusing to start the API or modify data/,
      );
    });
  }

  for (const url of [
    undefined,
    '',
    'invalid URL',
    'postgresql://test:secret@127.0.0.1/trading_orders',
    'postgresql://test:secret@127.0.0.1/trading_orders_prisma_dev',
    'postgresql://test:secret@remote.example/trading_orders_test',
    'https://127.0.0.1/trading_orders_test',
  ]) {
    it('rejects an invalid or non-test destination without exposing credentials', () => {
      assert.throws(
        () => assertLocalTestDatabase(url),
        (error) => {
          assert.match(error.message, /refusing to start the API or modify data/);
          assert(!error.message.includes('secret'));
          return true;
        },
      );
    });
  }
});
