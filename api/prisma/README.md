# Prisma

Prisma ORM 7.10.1 manages the PostgreSQL model and supplies instrument and contract-type data to NestJS. `GET /instruments` and `GET /contract-types` read their tables through the generated client; `GET /orders` serves `api/data/order-data.json`. Angular loads these endpoints during SSR and reuses the responses through HTTP Transfer Cache. Adding and closing orders changes browser memory only.

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

Compose also maintains the SQL database `trading_orders`. Its initialization scripts do not populate the separately created Prisma database. Do not point the initial Prisma migration at `trading_orders` or any other database whose tables were created manually; adopting an existing schema requires baselining it first. The native server setup is described in [the SQL guide](../../db/README.md#windows-without-docker).

## Generate, migrate and seed

After checking that `DATABASE_URL` names the separate empty database, run:

```bash
npm run db:generate
npm run db:typecheck
npm run db:migrate
npm run db:seed
npm run db:verify
```

`db:migrate` runs `prisma migrate deploy`, applying the committed migration history. Running it again applies only pending migrations. `db:seed` runs `prisma db seed` explicitly: Prisma 7 does not run the seed automatically after migration. `db:generate` creates the typed client in `api/prisma/generated`; `build:api` also generates it before compiling the backend and client into `dist/api`.

The seed replaces the entire development snapshot in one transaction. It deletes orders, instruments and contract types, then inserts contract types, instruments and orders. A successful run leaves exactly **6 contract types, 108 instruments and 213 orders**, including when additional records existed before the run. A failed transaction preserves the previous data. Use this seed only for the intended development database: it removes additional records from these three tables.

`db:verify` reads every record through Prisma and compares it with the fixtures, including exact decimal values, millisecond timestamps and relations. It also checks for sub-millisecond opening times and verifies the SQL JOIN across all three tables. It does not write to the database. For an already migrated and seeded database, use this command to verify the snapshot without rerunning the seed.

All three JSON files in `api/data` remain inputs to the seed, verification scripts and tests. `instruments.json` and `contract-types.json` are reference snapshots rather than runtime data sources for their HTTP endpoints.

To verify the HTTP endpoints against this running, migrated and seeded database:

```bash
npm run test:api
npm run db:verify
```

`test:api` builds the backend and checks response formats, fixture values, order filtering and validation, database reads, Decimal conversion, database failures and timeouts. Temporary instrument and contract-type records are removed after the tests. The suite also checks SQL cancellation under a table lock, recovery and application shutdown.

Run the suite against `trading_orders_prisma_dev` on a loopback host (`localhost`, `127.0.0.1` or `::1`). Both the HTTP contract suite and the lock test enforce this restriction; the HTTP suite validates `DATABASE_URL` before starting NestJS or touching data. Tests run serially; do not run another API suite or seed concurrently. They use the existing database without resetting it, applying migrations or seeding it. Run `db:verify` afterwards to confirm the original snapshot and cleanup.

## NestJS data access

`PrismaModule` in `api/src/prisma` exports a shared `PrismaService`. It wraps `createPrismaClient()` and disconnects when NestJS shuts down. Both database-backed endpoint modules use this client.

| Endpoint              | Response                                           | Ordering                                                                         |
| --------------------- | -------------------------------------------------- | -------------------------------------------------------------------------------- |
| `GET /instruments`    | `{ symbol: string, contractType: number }[]`       | Symbol, using JavaScript string comparison independently of PostgreSQL collation |
| `GET /contract-types` | `{ contractType: number, contractSize: number }[]` | `contractType` ascending                                                         |

Contract sizes are converted from Prisma `Decimal` to positive, finite JavaScript numbers and compared with the original Decimal after converting the number back to text. The six seeded sizes are `1`, `10`, `100`, `1000`, `10000` and `100000`. Overflow (`1e400`), underflow to zero (`1e-400`), precision loss (`9007199254740993`) and nonpositive values produce HTTP 500.

Database failures produce HTTP 500 with `{ "statusCode": 500, "message": "Internal server error" }`, without connection details or a fixture/empty-array fallback. Fixture-backed `GET /orders` remains available during a database outage.

The runtime reads `DATABASE_URL` from the environment or the `.env` in its launch working directory. Start the API from the repository root with `npm run start:api`; when launching the compiled artifact elsewhere, provide `DATABASE_URL` through the environment.

The shared factory defines `DATABASE_TIMEOUTS` with the following defaults, used by the API, seed and verify without additional environment variables:

| Setting                   | Value    | Effect                                                                  |
| ------------------------- | -------- | ----------------------------------------------------------------------- |
| `connectionTimeoutMillis` | 1,000 ms | Bounds connection/handshake and pool checkout waits in `pg`             |
| `statement_timeout`       | 2,000 ms | PostgreSQL cancels each SQL statement, including time waiting for locks |

These limits apply per connection attempt and SQL statement rather than to an entire HTTP request or transaction. Angular's HTTP timeout is 5 seconds. If an HTTP caller disconnects, the database limits still bound the remaining operation. Each seed statement has the same SQL limit; a timed-out statement causes the transaction to roll back. The settings apply to client sessions rather than changing database-wide configuration.

To inspect the joined records with `psql`, connect to `trading_orders_prisma_dev` and run:

```sql
SELECT o.id, o.symbol, o.side, o.size, o.open_price, o.open_time,
       o.swap, ct.contract_size
FROM orders AS o
JOIN instruments AS i ON i.symbol = o.symbol
JOIN contract_types AS ct ON ct.contract_type = i.contract_type
ORDER BY o.id;
```

The [SQL queries and constraint checks](../../db/README.md#join-grouping-and-constraints) can also target this database. Their `--docker` npm shortcut targets `trading_orders`; use an explicit `psql -d trading_orders_prisma_dev` command for the Prisma database.

## Model and exact values

- `schema.prisma` maps `ContractType`, `Instrument` and `Order` to `contract_types`, `instruments` and `orders`, with the original snake case columns, keys, indexes and restricted foreign key updates/deletes.
- Decimal fields use `Decimal @db.Decimal`, preserving unconstrained PostgreSQL `numeric`. The migration also preserves the original SQL CHECK constraints, including finite numeric values, positive sizes/prices, valid sides and finite opening times. Review those constraints when changing the schema because Prisma does not describe CHECK constraints.
- `fixtures.ts` uses `lossless-json` to read original numeric tokens as strings. Contract sizes, order sizes, opening prices and swaps go directly from those strings to `Prisma.Decimal`, including exponent notation, without passing through JavaScript `number`.
- Order identifiers become `bigint`. Contract type identifiers and opening times are checked as safe integers. JSON `openTime` is already Unix milliseconds: `new Date(milliseconds)` stores the same instant in `timestamptz(6)`. Verification compares `Date.getTime()` back to the fixture milliseconds and checks `open_time = date_trunc('milliseconds', open_time)` in PostgreSQL to detect additional microseconds.
- `client.ts` initializes `PrismaClient` with the PostgreSQL `@prisma/adapter-pg` driver adapter and `DATABASE_URL`. Both the scripts and NestJS use this factory. The orders table is populated and verified by Prisma scripts; the HTTP orders endpoint reads the JSON fixture.

For schema changes, edit `schema.prisma` and use `npm run db:migrate:dev -- --name descriptive_change` against a dedicated development database. Inspect generated SQL before applying or committing it, especially existing CHECK constraints. Apply committed migrations with `npm run db:migrate`.

Prisma references: [Prisma 7 database drivers](https://www.prisma.io/docs/orm/v7/core-concepts/supported-databases/database-drivers), [explicit seeding](https://www.prisma.io/docs/orm/v7/prisma-migrate/workflows/seeding), and [Prisma 7 upgrade notes](https://www.prisma.io/docs/guides/upgrade-prisma-orm/v7).
