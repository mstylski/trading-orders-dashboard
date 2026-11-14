import assert from 'node:assert/strict';
import { URL } from 'node:url';

// Keep this check synchronous and call it before constructing clients or starting
// Nest: query parameters can change where PostgreSQL drivers connect.
export function assertLocalDevelopmentDatabase(connectionString) {
  const message =
    'HTTP integration tests require DATABASE_URL to use PostgreSQL on localhost, 127.0.0.1 or ::1 with database trading_orders_prisma_dev and no connection query overrides; refusing to start the API or modify data.';
  let databaseUrl;
  try {
    databaseUrl = new URL(connectionString ?? '');
  } catch {
    assert.fail(message);
  }
  assert(
    ['postgres:', 'postgresql:'].includes(databaseUrl.protocol) &&
      ['localhost', '127.0.0.1', '[::1]'].includes(databaseUrl.hostname) &&
      databaseUrl.pathname === '/trading_orders_prisma_dev' &&
      !['host', 'port', 'database', 'connectionString'].some((key) =>
        databaseUrl.searchParams.has(key),
      ),
    message,
  );
  return databaseUrl;
}
