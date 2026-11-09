# Prisma

Prisma ORM 7.10.1 describes and seeds the PostgreSQL model independently of the HTTP API. NestJS still serves `api/data/*.json`, and Angular continues to consume those responses. Connecting an endpoint to the generated client is a later stage.

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

`db:migrate` runs `prisma migrate deploy`, applying the committed migration history. Running it again applies only pending migrations. `db:seed` runs `prisma db seed` explicitly: Prisma 7 does not run the seed automatically after migration. `db:generate` creates the typed client in `api/prisma/generated`; regenerate after schema changes or a clean installation.

The seed replaces the entire development snapshot in one transaction. It deletes orders, instruments and contract types, then inserts contract types, instruments and orders. A successful run leaves exactly **6 contract types, 108 instruments and 213 orders**, including when additional records existed before the run. A failed transaction preserves the previous data. Use this seed only for the intended development database: it removes additional records from these three tables.

`db:verify` reads every record through Prisma and compares it with the fixtures, including exact decimal equality and millisecond timestamps. A SQL check also rejects sub-millisecond opening times, which JavaScript `Date` cannot preserve. It follows both relations, runs a SQL JOIN across all three tables, checks that the JOIN returns 213 rows and prints sample orders. Running seed and verification twice checks repeatability. `test:api` checks the existing JSON HTTP responses independently of PostgreSQL.

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
- `client.ts` initializes `PrismaClient` with the PostgreSQL `@prisma/adapter-pg` driver adapter and `DATABASE_URL`. These scripts do not add Prisma to a NestJS module or change the JSON API contract; any future Decimal/BigInt/Date response mapping belongs at that integration boundary.

For future schema changes, edit `schema.prisma` and use `npm run db:migrate:dev -- --name descriptive_change` against a dedicated development database. Inspect generated SQL before applying or committing it, especially existing CHECK constraints. The committed initial migration is sufficient for this stage; do not recreate or reset the historical SQL database.

Prisma references: [Prisma 7 database drivers](https://www.prisma.io/docs/orm/v7/core-concepts/supported-databases/database-drivers), [explicit seeding](https://www.prisma.io/docs/orm/v7/prisma-migrate/workflows/seeding), and [Prisma 7 upgrade notes](https://www.prisma.io/docs/guides/upgrade-prisma-orm/v7).
