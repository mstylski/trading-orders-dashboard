import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from './generated/client';

export function createPrismaClient() {
  const connectionString = process.env['DATABASE_URL'];
  if (!connectionString) throw new Error('Set DATABASE_URL in the local, ignored .env file.');
  return new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
}
