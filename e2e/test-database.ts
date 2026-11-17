import 'dotenv/config';
import assert from 'node:assert/strict';

// Browser tests insert real orders. Refuse to start servers or create a pool
// unless the explicitly configured target is the dedicated local test database.
export function testDatabaseUrl(): string {
  const connectionString = process.env['TEST_DATABASE_URL'];
  const message =
    'E2E tests require TEST_DATABASE_URL for a local PostgreSQL database named trading_orders_test without connection query overrides.';
  let url: URL;
  try {
    url = new URL(connectionString ?? '');
  } catch {
    assert.fail(message);
  }
  assert(
    connectionString &&
      ['postgres:', 'postgresql:'].includes(url.protocol) &&
      ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) &&
      url.pathname === '/trading_orders_test' &&
      !['host', 'port', 'database', 'connectionString'].some((key) => url.searchParams.has(key)),
    message,
  );
  return connectionString;
}
