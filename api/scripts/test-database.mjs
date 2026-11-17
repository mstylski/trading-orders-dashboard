import 'dotenv/config';
import { execFileSync } from 'node:child_process';
import process from 'node:process';
import { URL } from 'node:url';
import pg from 'pg';
import { assertLocalTestDatabase } from '../test/support/database-safety.mjs';

// This explicit setup command resets fixtures only in the dedicated test DB.
// Normal test runs merely verify the snapshot and clean up their own records.
const mode = process.argv[2];
if (mode !== 'setup' && mode !== 'verify') throw new Error('Expected setup or verify');
const testUrl = assertLocalTestDatabase(process.env['TEST_DATABASE_URL']);
const env = { ...process.env, DATABASE_URL: testUrl.href };

function run(args) {
  execFileSync(process.execPath, args, { env, stdio: 'inherit', windowsHide: true });
}

if (mode === 'setup') {
  const adminUrl = new URL(testUrl);
  adminUrl.pathname = '/postgres';
  const client = new pg.Client({ connectionString: adminUrl.href, connectionTimeoutMillis: 2000 });
  try {
    await client.connect();
    const existing = await client.query('SELECT 1 FROM pg_database WHERE datname = $1', [
      'trading_orders_test',
    ]);
    if (!existing.rowCount) await client.query('CREATE DATABASE "trading_orders_test"');
  } finally {
    await client.end();
  }
  run(['node_modules/prisma/build/index.js', 'migrate', 'deploy']);
  run(['--import', 'tsx', 'api/prisma/seed.ts']);
}
run(['--import', 'tsx', 'api/prisma/verify.ts']);
