# Prisma

Prisma ORM 7.10.1 manages the PostgreSQL model and supplies orders, instruments and contract types to NestJS. The three GET endpoints read their tables through the generated client; `POST /orders` persists a new order. Angular loads the initial data during SSR and reuses the responses through HTTP Transfer Cache. New orders enter the view after API confirmation. Closing orders still changes browser memory only.

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

The seed replaces the entire development snapshot in one transaction. It deletes orders and their related creation operations, instruments and contract types, then inserts contract types, instruments and orders and advances the order ID sequence beyond the seeded IDs. A successful run leaves exactly **6 contract types, 108 instruments and 213 orders**, including when additional records existed before the run. A failed transaction preserves the previous table data. Use this seed only when intentionally replacing the development snapshot: it removes additional records and their idempotency history.

`db:verify` reads every record through Prisma and compares it with the fixtures, including exact decimal values, millisecond timestamps and relations. It also checks for sub-millisecond opening times, verifies the SQL JOIN across all three tables, and requires the operation registry to be empty for the reference snapshot. It does not write to the database. Added orders cause a snapshot mismatch as expected. For an existing development database, apply pending migrations with `npm run db:migrate`; no reseed is needed to enable POST, and a reseed would remove those orders.

All three JSON files in `api/data` remain inputs to the seed, verification scripts and tests. They are reference snapshots rather than runtime data sources for the HTTP endpoints.

## Dedicated integration database

HTTP and browser tests use a separate database and never write to `DATABASE_URL`. Set the following variable in the ignored `.env`, using the actual local credentials and port:

```dotenv
TEST_DATABASE_URL=postgresql://trading:YOUR_URL_ENCODED_PASSWORD@127.0.0.1:5432/trading_orders_test
```

Prepare the database explicitly, then run the HTTP suite:

```bash
npm run db:generate
npm run db:test:setup
npm run db:test:verify
npm run test:api
npm run db:test:verify
```

`db:test:setup` connects to the `postgres` maintenance database, creates `trading_orders_test` if missing, applies migrations, replaces the test snapshot using the seed, and verifies it. The configured user needs access to `postgres` and `CREATEDB` permission if the database is missing. Setup deliberately resets test data; routine test runs do not. `db:test:verify` performs only the full fixture comparison against this dedicated database.

`test:api` builds the backend and checks POST persistence, GET readback, required/invalid/extra fields (400), unknown instruments (404), fixture ordering, numeric/time conversion, database failures and timeouts. Temporary orders, instruments and contract types are removed in `finally`, including when an HTTP assertion fails. The suite also checks SQL cancellation under a table lock, recovery and application shutdown.

The shared URL guard requires PostgreSQL, a loopback host (`localhost`, `127.0.0.1` or `::1`) and exactly `trading_orders_test`. It rejects missing configuration and connection query overrides such as `?database=trading_orders` before connecting or starting NestJS, without disclosing credentials. API tests run serially; do not run seeds, API or E2E suites concurrently. Normal tests neither reset data nor apply migrations. Use `db:test:verify` before and afterwards to confirm cleanup. `npm run test:e2e` verifies the same test database, builds both applications and checks production SSR/hydration plus successful and rejected saves; see [browser verification](../../README.md#playwright-e2e-ssr-and-hydration).

## NestJS data access

`PrismaModule` in `api/src/prisma` exports a shared `PrismaService`. It wraps `createPrismaClient()` and disconnects when NestJS shuts down. All three endpoint modules use this client.

| Endpoint              | Response                                           | Ordering                                                                         |
| --------------------- | -------------------------------------------------- | -------------------------------------------------------------------------------- |
| `GET /orders`         | `{ data: Order[] }`                                | Internal `displayOrder` ascending, nulls last, then `id` ascending               |
| `POST /orders`        | HTTP 201, `{ data: Order }`                        | New rows follow the seeded snapshot in GET                                       |
| `GET /instruments`    | `{ symbol: string, contractType: number }[]`       | Symbol, using JavaScript string comparison independently of PostgreSQL collation |
| `GET /contract-types` | `{ contractType: number, contractSize: number }[]` | `contractType` ascending                                                         |

Contract sizes are converted from Prisma `Decimal` to positive, finite JavaScript numbers and compared with the original Decimal after converting the number back to text. The six seeded sizes are `1`, `10`, `100`, `1000`, `10000` and `100000`. Overflow (`1e400`), underflow to zero (`1e-400`), precision loss (`9007199254740993`) and nonpositive values produce HTTP 500.

Orders are read in full, without pagination: the dashboard groups and summarizes the complete set. The original fixture is neither ID-, time- nor symbol-sorted. It has 108 contiguous symbol groups and ascending IDs within each group; the frontend preserves first-seen group order. The migration backfills an internal nullable `display_order` using the original 213 fixture positions, and the seed supplies those same positions. Ordering by `display_order ASC NULLS LAST, id ASC` preserves the existing response and view. Newly inserted rows without a rank follow the snapshot in ID order. The internal rank is excluded from the HTTP response.

Each order is explicitly mapped to exactly `id`, `symbol`, `side`, `size`, `openPrice`, `openTime` and `swap`. BigInt IDs must be within JavaScript's safe integer range before conversion to `number`. The three Decimal fields use the same decimal-to-number-to-text equality check as contract sizes; sizes and prices must be positive, while swaps may be negative or zero. `Date.getTime()` returns Unix milliseconds. A PostgreSQL check rejects sub-millisecond timestamps before a truncated `Date` can reach JSON. Both reads run in a Repeatable Read transaction so that the records and precision check observe the same snapshot.

The model has no order status column and contains open orders only. Omitted status and case-insensitive `open` read the current database set; `closed` returns `{ data: [] }`. Invalid and repeated values return HTTP 400 before database access.

`POST /orders` accepts exactly `{ symbol, side, size, openPrice }`. The DTO and global `ValidationPipe` require nonblank text for `symbol`, `BUY` or `SELL` for `side`, and finite numbers greater than zero for `size` and `openPrice`. Missing fields, numeric strings and extra properties are rejected with HTTP 400; the client cannot supply `id`, `openTime` or `swap`. The service checks instrument existence and returns 404 with `Instrument not found` if absent. NestJS errors use `{ statusCode, message, error }`, with an array of messages for DTO validation.

The order ID migration adds a database sequence initialized beyond existing IDs and capped at JavaScript's maximum safe integer. Prisma uses the sequence default; the API assigns `openTime: new Date()` inside the order-creation transaction (backend clock, millisecond precision, stored as a UTC instant) and supplies `swap: 0`. It does not use PostgreSQL's microsecond-precision `now()` default. The created row uses the same checked BigInt, Decimal and date mapping as GET and returns HTTP 201 with `{ data: Order }`. `displayOrder` stays null so it follows the original snapshot.

`POST /orders` requires a UUID in `Idempotency-Key`. The durable registry has a unique scope/key pair, a SHA-256 hash of the normalized DTO, and the successful HTTP status and JSON response body. Key reservation, order creation and response recording are atomic in one transaction. Concurrent attempts wait on PostgreSQL's unique constraint: after the winning transaction commits, the other attempt reads and replays its saved response. Identical data returns the same 201 and `order.id`; different data returns 409 with `code: "IDEMPOTENCY_KEY_REUSED"`. Missing or malformed keys return 400. Different keys with identical DTOs create separate orders. Rollback removes both the reservation and order, allowing a later attempt with that key to succeed. The registry survives application restarts and has no automatic expiry. The current scope is `POST /orders`; authenticated user identity must become part of that scope when authentication is added. [PostgreSQL unique checks](https://www.postgresql.org/docs/current/index-unique-checks.html) describe waiting for concurrent transactions during uniqueness enforcement.

Angular preserves the operation key and original payload, including the quoted opening price, for uncertain outcomes. Browser-only `sessionStorage` retains that operation across reloads. Confirmed responses update the store by order ID, so replay does not create a duplicate view row. The idempotency transaction is part of this stage; broader trading rules remain outside it.

Database failures or unsafe conversions produce HTTP 500 with `{ "statusCode": 500, "message": "Internal server error" }`, without connection details or a fixture/empty-array fallback.

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

## Inspecting the orders SQL and plan

[orders.sql](orders.sql) contains the equivalent reads and an `EXPLAIN (ANALYZE, BUFFERS)` example. Run it with `psql` connected explicitly to `trading_orders_prisma_dev` after applying migrations. It reads all orders in a Repeatable Read snapshot; the timestamp check must return no rows. The SQL returns native database types, and `OrdersService` performs the checked JSON conversion described above.

The following query was captured from the compiled `OrdersService.list()` using a separate Prisma client with `log: [{ emit: 'event', level: 'query' }]` and `$on('query', ...)`. Query logging is not enabled in the API's shared client. Whitespace is normalized here:

```sql
SELECT "public"."orders"."id", "public"."orders"."symbol",
       "public"."orders"."side", "public"."orders"."size",
       "public"."orders"."open_price", "public"."orders"."open_time",
       "public"."orders"."swap"
FROM "public"."orders"
WHERE 1=1
ORDER BY "public"."orders"."display_order" ASC NULLS LAST,
         "public"."orders"."id" ASC
OFFSET $1;
-- Captured parameters: ["0"]
```

Prisma emits `OFFSET 0` as a default; there is no `LIMIT` on the order read and no pagination. The first captured statement is the raw timestamp precision check from `orders.sql`, followed by this SELECT and `COMMIT`.

Running `EXPLAIN (ANALYZE, BUFFERS)` on that actual Prisma SELECT against the 213-row development snapshot produced:

```text
Sort  (cost=15.37..15.90 rows=213 width=48) (actual time=0.143..0.162 rows=213.00 loops=1)
  Sort Key: display_order, id
  Sort Method: quicksort  Memory: 40kB
  Buffers: shared hit=11
  ->  Seq Scan on orders  (cost=0.00..7.13 rows=213 width=48) (actual time=0.020..0.048 rows=213.00 loops=1)
        Buffers: shared hit=5
Planning:
  Buffers: shared hit=126
Planning Time: 0.583 ms
Execution Time: 0.260 ms
```

Read this plan from the child node upward: `Seq Scan` reads all 213 rows, then `Sort` applies the explicit dashboard order. Estimated and actual row counts both equal 213. `cost` is the planner's estimate in internal cost units; `actual time` and the final execution time are measured milliseconds. `shared hit` counts buffer accesses already satisfied from PostgreSQL's cache. A sequential scan with an in-memory sort is reasonable when the endpoint needs every row of this small table; an index is not needed merely because the plan contains `Seq Scan`. Timings and buffer counts vary between runs. `ANALYZE` executes the SELECT, while plain `EXPLAIN` only estimates its plan.

## Model and exact values

- `schema.prisma` maps `ContractType`, `Instrument` and `Order` to `contract_types`, `instruments` and `orders`, with the original snake case columns, keys, indexes and restricted foreign key updates/deletes.
- Decimal fields use `Decimal @db.Decimal`, preserving unconstrained PostgreSQL `numeric`. The migration also preserves the original SQL CHECK constraints, including finite numeric values, positive sizes/prices, valid sides and finite opening times. Review those constraints when changing the schema because Prisma does not describe CHECK constraints.
- `fixtures.ts` uses `lossless-json` to read original numeric tokens as strings. Contract sizes, order sizes, opening prices and swaps go directly from those strings to `Prisma.Decimal`, including exponent notation, without passing through JavaScript `number`.
- Order identifiers become `bigint`. Contract type identifiers and opening times are checked as safe integers. JSON `openTime` is already Unix milliseconds: `new Date(milliseconds)` stores the same instant in `timestamptz(6)`. Verification and the HTTP endpoint check `open_time = date_trunc('milliseconds', open_time)` in PostgreSQL to detect additional microseconds; verification also compares `Date.getTime()` with the fixture milliseconds.
- `client.ts` initializes `PrismaClient` with the PostgreSQL `@prisma/adapter-pg` driver adapter and `DATABASE_URL`. Both the scripts and NestJS use this factory; test tools substitute the guarded `TEST_DATABASE_URL`. HTTP reads and order creation use Prisma.

For schema changes, edit `schema.prisma` and use `npm run db:migrate:dev -- --name descriptive_change` against a dedicated development database. Inspect generated SQL before applying or committing it, especially existing CHECK constraints. Apply committed migrations with `npm run db:migrate`.

Prisma references: [Prisma 7 database drivers](https://www.prisma.io/docs/orm/v7/core-concepts/supported-databases/database-drivers), [explicit seeding](https://www.prisma.io/docs/orm/v7/prisma-migrate/workflows/seeding), and [Prisma 7 upgrade notes](https://www.prisma.io/docs/guides/upgrade-prisma-orm/v7).
