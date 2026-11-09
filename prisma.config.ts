import 'dotenv/config';
import { defineConfig, env } from 'prisma/config';

export default defineConfig({
  schema: 'api/prisma/schema.prisma',
  migrations: {
    path: 'api/prisma/migrations',
    seed: 'tsx api/prisma/seed.ts',
  },
  datasource: {
    url: env('DATABASE_URL'),
  },
});
