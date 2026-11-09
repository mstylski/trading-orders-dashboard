# Prisma

Prisma ORM 7.10.1 describes and seeds the PostgreSQL model and supplies instrument data to NestJS. `GET /instruments` reads the `instruments` table through the generated client; `GET /orders` and `GET /contract-types` still serve `api/data/*.json`. Angular uses the same HTTP contract, SSR and HTTP Transfer Cache.

Run the commands below from the repository root. Node.js 24 LTS and a running PostgreSQL server are required; Docker is optional. The root `prisma.config.ts` locates the backend schema, migrations and seed and reads `DATABASE_URL` from the ignored local `.env` file.

## Create a separate database

Install the locked dependencies:

```bash
npm ci
```

Copy `.env.example` to `.env` if that file does not exist. Keep any existing PostgreSQL password there. Set `DATABASE_URL` to the new database, for example:

```dotenv
DATABASE_URL=postgresql://trading:YOUR_URL_ENCODED_PASSWORD@127.0.0.1:5432/trading_orders_prisma_dev
```

Replace the placeholder with the local password, percent-encoding reserved URL characters. Use the server's actual port if it differs from 5432. The tracked `.env.example` contains no password; `.env` and generated client files stay ignored by Git.

Create `trading_orders_prisma_dev` once, with no application tables. For a native PostgreSQL server, use `createdb` from its `bin` directory or `PATH`, with the existing local credentials (`-W` prompts for the password):

```bash
createdb -h 127.0.0.1 -p 5432 -U trading -W trading_orders_prisma_dev
```

Alternatively, for the repository's Compose service:

```bash
docker compose up -d --wait
docker compose exec postgres createdb -U trading trading_orders_prisma_dev
```

Compose also maintains the historical SQL database `trading_orders`. Its initialization scripts do not populate the separately created Prisma database. Do not point the first Prisma migration at `trading_orders` or any other database whose tables were created manually. Adopting an existing database will require a separately planned baseline; this stage does not establish one. The existing native server setup is described in [the SQL guide](../../db/README.md#windows-without-docker).

## Generate, migrate and seed

After checking that `DATABASE_URL` names the separate empty database, run:

```bash
npm run db:generate
npm run db:typecheck
npm run db:migrate
npm run db:seed
npm run db:verify
npm run db:seed
npm run db:verify
npm run test:api
```

`db:migrate` runs `prisma migrate deploy`, applying the committed migration history. Running it again applies only pending migrations. `db:seed` runs `prisma db seed` explicitly: Prisma 7 does not run the seed automatically after migration. `db:generate` creates the typed client in `api/prisma/generated`; `build:api` also generates it before compiling the backend and client into `dist/api`.

The seed replaces the entire development snapshot in one transaction. It deletes orders, instruments and contract types, then inserts contract types, instruments and orders. A successful run leaves exactly **6 contract types, 108 instruments and 213 orders**, including when additional records existed before the run. A failed transaction preserves the previous data. Use this seed only for the intended development database: it removes additional records from these three tables.

`db:verify` reads every record through Prisma and compares it with the fixtures, including exact decimal equality and millisecond timestamps. A SQL check also rejects sub-millisecond opening times, which JavaScript `Date` cannot preserve. It follows both relations, runs a SQL JOIN across all three tables, checks that the JOIN returns 213 rows and prints sample orders. Running seed and verification twice checks repeatability.

`test:api` requires this running, migrated and seeded database. It compares the complete `GET /instruments` response with the fixture, including 108 records and selected symbols, and verifies the other endpoints retain their fixture responses. It inserts a unique temporary instrument, checks that the HTTP endpoint returns it, then removes it in cleanup. Run it against the development database without a concurrent seed. Query failures, connection failures and missing data fail the suite instead of falling back to fixtures.

## NestJS data access

`PrismaModule` in `api/src/prisma` exports a shared `PrismaService` created through NestJS DI. The service wraps the existing `createPrismaClient()` factory and disconnects its client when the application closes. `InstrumentsModule` uses that shared client to select `symbol` and `contractType` from `instruments` and explicitly maps the results to the existing JSON fields and types. It sorts symbols using JavaScript string comparison to preserve fixture order independently of PostgreSQL collation (including `FR.FR` before `FR40`). There is no fixture fallback for this endpoint.

The runtime reads `DATABASE_URL` from the environment or the `.env` in its launch working directory. Start the API from the repository root with `npm run start:api`; when launching the compiled artifact elsewhere, provide `DATABASE_URL` through the environment. The frontend's URLs, data validation and transfer cache configuration stay unchanged.

The shared factory sets `connectionTimeoutMillis: 1000` for connection/handshake and pool checkout, and PostgreSQL `statement_timeout: 2000` for every statement, including lock waits. The combined normal wait budget stays below Angular's 5-second HTTP timeout. The server cancels timed-out SQL even after an HTTP caller disconnects; there is no Promise race or fixture fallback. A driver-only `query_timeout` does not cancel server work and is deliberately not used. Seed and verify use these same fixed limits. The seed still runs as one atomic interactive transaction (its existing Prisma transaction deadline is unchanged); the 2-second limit applies separately to each SQL statement, not to the entire seed. No database-wide configuration or applied migration is changed.

To inspect the joined records with `psql`, connect to `trading_orders_prisma_dev` and run:

```sql
SELECT o.id, o.symbol, o.side, o.size, o.open_price, o.open_time,
       o.swap, ct.contract_size
FROM orders AS o
JOIN instruments AS i ON i.symbol = o.symbol
JOIN contract_types AS ct ON ct.contract_type = i.contract_type
ORDER BY o.id;
```

The existing [SQL queries and constraint checks](../../db/README.md#join-grouping-and-constraints) can also target this database. Their `--docker` npm shortcut targets the historical `trading_orders` database; use an explicit `psql -d trading_orders_prisma_dev` command for the Prisma database.

## Model and exact values

- `schema.prisma` maps `ContractType`, `Instrument` and `Order` to `contract_types`, `instruments` and `orders`, with the original snake case columns, keys, indexes and restricted foreign key updates/deletes.
- Decimal fields use `Decimal @db.Decimal`, preserving unconstrained PostgreSQL `numeric`. The migration also preserves the original SQL CHECK constraints, including finite numeric values, positive sizes/prices, valid sides and finite opening times. Review those constraints when changing the schema because Prisma does not describe CHECK constraints.
- `fixtures.ts` uses `lossless-json` to read original numeric tokens as strings. Contract sizes, order sizes, opening prices and swaps go directly from those strings to `Prisma.Decimal`, including exponent notation, without passing through JavaScript `number`.
- Order identifiers become `bigint`. Contract type identifiers and opening times are checked as safe integers. JSON `openTime` is already Unix milliseconds: `new Date(milliseconds)` stores the same instant in `timestamptz(6)`. Verification compares `Date.getTime()` back to the fixture milliseconds and checks `open_time = date_trunc('milliseconds', open_time)` in PostgreSQL to detect additional microseconds.
- `client.ts` initializes `PrismaClient` with the PostgreSQL `@prisma/adapter-pg` driver adapter and `DATABASE_URL`. Both the scripts and NestJS use this factory. Instrument fields already map to JSON string and number values; Decimal/BigInt/Date response mapping remains for a later endpoint migration.

For future schema changes, edit `schema.prisma` and use `npm run db:migrate:dev -- --name descriptive_change` against a dedicated development database. Inspect generated SQL before applying or committing it, especially existing CHECK constraints. The committed initial migration is sufficient for this stage; do not recreate or reset the historical SQL database.

Prisma references: [Prisma 7 database drivers](https://www.prisma.io/docs/orm/v7/core-concepts/supported-databases/database-drivers), [explicit seeding](https://www.prisma.io/docs/orm/v7/prisma-migrate/workflows/seeding), and [Prisma 7 upgrade notes](https://www.prisma.io/docs/guides/upgrade-prisma-orm/v7).
