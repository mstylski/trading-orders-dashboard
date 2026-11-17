import assert from 'node:assert/strict';
import { URL } from 'node:url';

// Keep this check synchronous and call it before constructing clients or starting
// Nest: query parameters can change where PostgreSQL drivers connect.
export function assertLocalTestDatabase(connectionString) {
  const message =
    'HTTP integration tests require TEST_DATABASE_URL to use PostgreSQL on localhost, 127.0.0.1 or ::1 with the dedicated database trading_orders_test and no connection query overrides; refusing to start the API or modify data.';
  let databaseUrl;
  try {
    databaseUrl = new URL(connectionString ?? '');
  } catch {
    assert.fail(message);
  }
  assert(
    ['postgres:', 'postgresql:'].includes(databaseUrl.protocol) &&
      ['localhost', '127.0.0.1', '[::1]'].includes(databaseUrl.hostname) &&
      databaseUrl.pathname === '/trading_orders_test' &&
      !['host', 'port', 'database', 'connectionString'].some((key) =>
        databaseUrl.searchParams.has(key),
      ),
    message,
  );
  return databaseUrl;
}
