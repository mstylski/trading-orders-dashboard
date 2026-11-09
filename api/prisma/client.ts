import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from './generated/client';

// Shared by the API, seed and verify. Bound pool/handshake waits and cancel SQL
// on PostgreSQL (including lock waits), below Angular's 5-second HTTP timeout.
export const DATABASE_TIMEOUTS = {
  connectionTimeoutMillis: 1_000,
  statement_timeout: 2_000,
} as const;

export function createPrismaClient() {
  const connectionString = process.env['DATABASE_URL'];
  if (!connectionString) throw new Error('Set DATABASE_URL in the local, ignored .env file.');
  return new PrismaClient({ adapter: new PrismaPg({ connectionString, ...DATABASE_TIMEOUTS }) });
}
