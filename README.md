# Trading Orders Dashboard

An Angular 22.2.1 application with server-side rendering (SSR) for viewing orders grouped by symbol. It shows position profits based on WebSocket quotes, saves new orders through NestJS to PostgreSQL, lets you close orders locally, and supports light, dark, or system themes.

## Getting started

Node.js 24 LTS (at least 24.15.0) and npm are required. Run all commands from the repository root unless noted otherwise. Install the dependencies:

```bash
npm ci
```

On Windows, use `npm.cmd` instead of `npm` if PowerShell blocks the `npm.ps1` launcher.

Start PostgreSQL, configure `DATABASE_URL` in the ignored local `.env`, and prepare the separate `trading_orders_prisma_dev` database using [the Prisma guide](api/prisma/README.md). For first-time setup of that database, apply the migration and load the development snapshot:

```bash
npm run db:generate
npm run db:migrate
npm run db:seed
npm run db:verify
```

For an existing database, apply pending migrations with `npm run db:migrate` before starting the API. Do not rerun the seed just to start the application: it replaces all three tables' contents and removes added orders. `db:verify` compares the exact reference snapshot, so it will report a mismatch after an order has been saved.

Start the local NestJS API and leave it running:

```bash
npm run start:api
```

In another terminal, start the dashboard:

```bash
npm start
```

The development application is available at `http://localhost:4200/`. For the production SSR server, keep the API running, then build and run:

```bash
npm run build
npm run serve:ssr:trading-orders-dashboard
```

The API listens at `http://localhost:3000/` by default (`API_PORT` changes the port). The production SSR server listens at `http://localhost:4000/` by default (`PORT` changes the port). The browser needs access to the GeekSoft WebSocket endpoint for live quotes.

## HTTP API

All three GET endpoints read PostgreSQL through Prisma. The counts below describe the seeded development snapshot; the endpoints return current database records.

| Endpoint                      | Data source           | Response                                                             |
| ----------------------------- | --------------------- | -------------------------------------------------------------------- |
| `GET /instruments`            | PostgreSQL via Prisma | 108 `{ symbol, contractType }` records ordered by symbol             |
| `GET /orders`                 | PostgreSQL via Prisma | `{ data }` containing all 213 open orders, without pagination        |
| `POST /orders`                | PostgreSQL via Prisma | HTTP 201 with `{ data: Order }` containing the saved order           |
| `GET /orders/operations/:key` | Operation registry    | Saved HTTP status and original `{ data: Order }` for a UUID          |
| `GET /contract-types`         | PostgreSQL via Prisma | 6 `{ contractType, contractSize }` records ordered by `contractType` |

`GET /orders` accepts an optional, case-insensitive `status=open|closed` query parameter. The current model contains open orders only and has no status column, so omitting the parameter or requesting `open` returns all orders, and `closed` returns `{ data: [] }`. Invalid or repeated status values return HTTP 400. Closing an order in the dashboard still changes browser memory only.

`POST /orders` requires an `Idempotency-Key` header containing a UUID and accepts exactly these required fields:

```json
{ "symbol": "BTCUSD", "side": "BUY", "size": 1.5, "openPrice": 67250.25 }
```

The global NestJS `ValidationPipe` validates the DTO at runtime: `symbol` must be nonblank text, `side` must be `BUY` or `SELL`, and `size` and `openPrice` must be finite numbers greater than zero. Numeric strings are rejected. Extra fields, including `id`, `openTime` and `swap`, return 400 without saving an order. An unknown instrument returns 404. Errors follow NestJS's `{ statusCode, message, error }` format, with a message array for DTO validation and a string for other HTTP errors. Unexpected database failures return the generic 500 described below.

The database generates the ID from a sequence. During creation inside the transaction, the API assigns `openTime` using `new Date()` from the backend clock, with millisecond precision, and sets swap to zero. The response is `{ data: { id, symbol, side, size, openPrice, openTime, swap } }`, using the same checked mapping as GET. Replays return the recorded response, including the original ID and opening time, rather than generating a new timestamp.

The durable operation registry stores the `POST /orders` scope, UUID, SHA-256 hash of the normalized DTO, HTTP status and successful response body. Reserving the key, inserting the order and saving the response happen in one PostgreSQL transaction. A unique constraint on scope and key resolves concurrent submissions. Repeating the same operation returns its original HTTP 201 and body, including the same `order.id`, even after restarting NestJS. Reusing a key with different data returns HTTP 409 with `code: "IDEMPOTENCY_KEY_REUSED"`; a missing or invalid key returns 400. Different keys represent separate operations even when their data matches. There is no automatic expiry. After authentication is introduced, the backend must include the authenticated user in the operation scope.

Angular captures the UUID and a copy of the payload, including the original quoted price, once per operation. It preserves an uncertain operation after a timeout, network error or server failure and stores it in browser-only `sessionStorage` so it can be retried after a reload. A retry uses the same key and exact payload. An explicitly new order receives a new key. The form prevents concurrent submissions, and confirmed responses update the store by `order.id`, avoiding duplicate rows on replay.

The form has no opening-time field. Angular sends only the symbol, side, volume and captured quote; the backend supplies the opening time. The request hash covers exactly these four fields in a fixed order.

Closing or cancelling the form preserves an uncertain operation. Reopening it or reloading the page restores its locked fields and offers **Ponów potwierdzenie**, which sends the original four-field snapshot and UUID without requiring a fresh quote. This also works for small volumes such as `0.0000001`, without rounding. Resolve the pending operation before starting another order; a confirmed operation releases the form for a new UUID.

### Resolving an operation from the previous version

The previous request format included a client-supplied `openTime`. A valid five-field pending snapshot under `trading-orders.pending-order.v1` is retained with its original UUID and full payload. Closing the panel or reloading does not remove it. New orders remain blocked until the earlier operation is resolved; the application does not strip its time, replace its key or change the old registry hash.

Choose **Sprawdź wynik zlecenia** to read `GET /orders/operations/:key`. For a completed operation, this read-only endpoint returns the original stored status (201) and body, including its original `order.id` and `openTime`. It does not insert an order or change the request hash. The page merges the confirmed order by ID and clears the pending snapshot. Invalid UUIDs return 400. A missing result returns 404 and leaves the pending operation intact: absence of a committed registry row does not prove an older request is no longer in flight. Connection failures likewise retain the pending snapshot, allowing another result check.

For manual investigation, copy the UUID shown in the panel and query the same environment's registry using an existing database connection:

```sql
SELECT scope, key, request_hash, status_code, order_id, response_body
FROM public.order_creations
WHERE scope = 'POST /orders' AND key = '<original-uuid>'::uuid;
```

A completed row identifies the original order and response; use **Sprawdź wynik zlecenia** to confirm it in the browser. If no row is visible, first establish that the original request/transaction has finished and verify its outcome with the operator. Do not submit the old payload to the new POST, remove `openTime` and retry it, or create a replacement under a new UUID while the outcome is uncertain. The current POST contract continues to reject client-supplied `openTime` and `id`; old successful hashes and response bodies remain unchanged.

Contract sizes and order decimal fields are returned as finite JSON numbers, converted from Prisma `Decimal`. Conversion must preserve the original decimal value when the number is serialized back to text. Order IDs are converted from `BigInt` only within JavaScript's safe integer range; opening times are Unix milliseconds. Database failures, overflow, underflow to zero and precision loss return a generic HTTP 500. Database-backed endpoints do not fall back to JSON fixtures. See [Prisma data access](api/prisma/README.md#nestjs-data-access) for exact order mapping and SQL inspection.

All three JSON files in `api/data` are required for the database seed, snapshot verification and tests. They provide reference data for those tools; the HTTP endpoints use PostgreSQL.

The shared Prisma client limits connection/handshake and pool checkout waits to **1,000 ms** and each SQL statement to **2,000 ms**, including time spent waiting for locks. These limits apply to the API, seed and verification scripts. They are per connection attempt or SQL statement; Angular's HTTP requests have a separate 5,000 ms timeout. See [Prisma data access](api/prisma/README.md#nestjs-data-access) for details.

`npm run build:api` generates the Prisma client, compiles the backend and client into `dist/api`, and copies its JSON reference files into `dist/api/data` for database tools. The HTTP endpoints do not read those files. The compiled artifact can run from another working directory without the source `api/data` folder. Node dependencies and `DATABASE_URL` are required at runtime. The local `.env` is loaded from the launch working directory; when launching elsewhere, supply `DATABASE_URL` through the environment. For example, with that variable already set, run from the project root:

```bash
npm run build:api
cd dist
node api/main.js
```

The API base URL is configured in `src/app/features/orders/data/orders-data.config.ts` for both SSR and the browser. Rebuild the dashboard after changing it. Angular HTTP transfer cache carries the SSR responses into hydration.

The SSR host allowlist in `angular.json` currently includes `localhost` and `127.0.0.1`. Add the deployment hostname before serving the application on another host.

## PostgreSQL

The repository includes a PostgreSQL 18.6 setup for SQL practice and Prisma ORM 7 for the backend data model. PostgreSQL is required for the HTTP reads, `POST /orders` and the dashboard's initial data load; Docker is optional.

Follow [the Prisma guide](api/prisma/README.md) to create a separate empty `trading_orders_prisma_dev` database, apply the committed migration and explicitly run the repeatable seed. The schema and scripts live in `api/prisma`, with configuration in the root `prisma.config.ts`. Keep `DATABASE_URL` and its password in the ignored `.env`; the example configuration contains no secret. The initial migration must not target the existing manually initialized SQL database.

With Docker Desktop running (Linux containers), copy `.env.example` to `.env` and set a nonempty `POSTGRES_PASSWORD` before starting Compose. The local `.env` file is ignored by Git. You can also supply the password through an environment variable; Compose rejects a missing or empty value.

```bash
docker compose up -d --wait
npm run test:db -- --docker
docker compose exec postgres psql -X -U trading -d trading_orders
```

Initialization creates `contract_types`, `instruments`, and `orders` with primary and foreign keys, then loads all 6 contract types, 108 instruments, and 213 orders from a SQL snapshot of `api/data`. See [the database guide](db/README.md) for the model, JOIN and GROUP BY queries, constraint verification, and a Windows setup without Docker.

Compose exposes PostgreSQL at `127.0.0.1:5432`, with database `trading_orders`, user `trading`, and the password configured above. Set `POSTGRES_PORT` to change the host port. The `postgres_data` volume preserves data across stops; initialization scripts run only when the data directory is empty, so editing them does not update an existing database. Prisma migrations manage the separate `trading_orders_prisma_dev` database; see [Prisma migrations](db/README.md#prisma-migrations).

## Verifying the project

```bash
npm run db:typecheck
npm run db:test:setup
npm run format:check
npm run lint
npm run test:api
npm test -- --watch=false
npm run build
npm run db:test:verify
```

Set `TEST_DATABASE_URL` in the ignored `.env` to a separate local `trading_orders_test` database, using URL-encoded credentials as in `DATABASE_URL`. `db:test:setup` creates that database if missing, applies migrations, replaces its snapshot through the seed, and verifies it. The configured user needs permission to connect to the `postgres` maintenance database and `CREATEDB` permission if the test database does not exist. Run setup once or when intentionally resetting test data; it never targets the development database. `db:test:verify` only reads and compares the test snapshot.

Angular tests use mocked HTTP and WebSocket responses. `test:api` builds the backend and starts NestJS on free local ports against `TEST_DATABASE_URL`. It checks POST persistence and GET readback, 400 validation, 404 for an unknown symbol, response formats, ordering, Decimal/time conversion, failures and timeouts. Temporary rows are removed in `finally`; the lock test releases its exclusive lock. The shared guard accepts only PostgreSQL on a loopback host (`localhost`, `127.0.0.1` or `::1`) with database `trading_orders_test`, rejecting connection query overrides before connecting without displaying credentials. Tests run serially and do not reset, migrate or reseed data. Avoid concurrent seed, API and E2E suites; run `db:test:verify` before and afterwards to confirm cleanup.

### Playwright E2E: SSR and hydration

Install the Chromium browser once after `npm ci`:

```bash
npx playwright install chromium
```

Start PostgreSQL and prepare `TEST_DATABASE_URL` with `npm run db:test:setup`. Ports 3000 and 4000 must be free: the suite first runs `db:test:verify`, builds the backend and production dashboard, starts its own real NestJS and Angular SSR servers using the test database, and stops those servers afterwards. It does not reuse an existing API or dashboard process.

Run twice against the same seed, without reseeding between runs:

```bash
npm run lint:e2e
npm run db:test:verify
npm run test:e2e
npm run db:test:verify
npm run test:e2e
npm run db:test:verify
```

Each E2E run executes the full fixture comparison **before and after** the tests, including after a failed browser assertion. It checks **6 contract types, 108 instruments, 213 orders**, all persisted values, exact decimals, timestamps and relations; a failed comparison fails the suite. Tests cover API reads, SSR/hydration, successful order persistence, a real API rejection, a lost response followed by a retry, and concurrent requests sharing a key. HTTP integration tests also verify replay after restarting NestJS, payload conflicts, independent keys and transaction rollback. Write scenarios clean up their own records; the verification hooks remain read only. Tests do not seed or migrate the database.

A separate API test uses Playwright's `request` fixture to check HTTP 200 and record counts for `/orders` (213), `/instruments` (108) and `/contract-types` (6). These requests run outside the browser context and are not counted as hydration duplicates.

The read-only browser scenario checks HTTP 200, the visible counters (213 orders and 108 groups), 108 rendered group rows and the BTCUSD group in the original SSR response body. It opens and cancels the deferred form, checks focus restoration and expands BTCUSD to show order 1203384. Request observation starts before navigation and rejects repeated browser GETs to the three initial endpoints or any writes in that scenario. Hydration errors and uncaught browser errors fail the test. The save scenarios use deterministic browser quotes and real POST requests to check success, persistence after reload and an error without a fictitious local order.

View the HTML report with `npx playwright show-report`. Failure traces and screenshots are saved in the ignored `test-results/`; the HTML report is in the ignored `playwright-report/`. Check E2E TypeScript and lint rules with `npm run lint:e2e`. For browser-test iterations after a successful build, `npx playwright test` skips rebuilding; `npm run test:e2e` always rebuilds both applications.

Database tests require a separately started and initialized PostgreSQL server: `npm run test:db -- --docker` uses Compose, while `npm run test:db` uses `psql` from `PATH` (or the `PSQL` executable path) and the `PGHOST`, `PGPORT`, `PGUSER`, `PGPASSWORD`, `PGDATABASE` connection variables. They run transactional constraint checks and compare all SQL records against the JSON fixtures, including exact decimals and millisecond timestamps. See [database testing instructions](db/README.md#repeatable-database-tests).

To run only the fixture comparison, use `npm run test:db:fixtures -- --docker` for Compose or `npm run test:db:fixtures` for a native server. Database tests do not reset or reseed the database.

Routine Prisma database verification uses `db:verify` without seeding. The [Prisma guide](api/prisma/README.md#generate-migrate-and-seed) explains initial setup and the seed's replacement strategy.

`lint` and both formatting commands cover the frontend, API, database and E2E test scripts, including API tests and build scripts. `lint:api` checks just the backend; `lint:db` checks the database test scripts; `lint:e2e` checks the browser tests and their TypeScript types. Angular-specific lint rules apply only to `src`.

## Structure and data flow

- `api` contains the NestJS HTTP endpoints, JSON fixtures, build scripts, and API tests. `api/src/prisma` provides the shared Prisma dependency through NestJS DI; the orders, instruments and contract-types services read and map their database records. `api/prisma` contains the Prisma client factory, schema, migrations, fixture seed and verification scripts for a separate database.
- `db` contains the standalone SQL schema, seed, example queries, and database tests; `compose.yaml` configures the PostgreSQL container.
- `e2e` contains Playwright SSR/hydration and order-save integration tests; `playwright.config.ts` starts the real API and production SSR server against the dedicated test database.
- `src/app/features/orders/data` fetches and validates data from three GET endpoints, saves orders through POST, and handles the WebSocket connection, symbol subscriptions, and reconnection.
- `src/app/features/orders/state` stores orders and exposes signals and operations for adding and closing them. The store is scoped to the page and releases the connection when the page is destroyed.
- `src/app/features/orders/domain` contains pure calculations for contract values, profits, and groups.
- `src/app/features/orders/components` contains the form and table; `orders-page` connects them to the state.
- `src/app/core` stores the theme preference.
- `src/app/shared` contains the theme switcher, notifications, and reusable type guards.
- `src/main.server.ts`, `src/app/app.config.server.ts`, `src/app/app.routes.server.ts`, and `src/server.ts` configure the server bootstrap, server rendering route, and Node server.

The store owns orders, load status, and the selected form symbol needed for quote subscriptions. A computed set of symbols drives WebSocket subscriptions; the page owns expanded rows. The notification service owns message limits and timers. Domain functions return typed reason codes, which the presentation layer translates into Polish messages.

HTTP payloads are validated as a whole. An invalid record or duplicate key rejects the affected response and shows a retryable error instead of silently omitting a position. Socket messages are parsed independently; invalid quote rows are rejected before updating prices, while valid rows from the same message are still accepted. Rejected messages and rows produce console warnings that distinguish invalid structure, missing fields, and invalid values, with the affected field or row index. Quotes for symbols that are no longer subscribed are ignored without a warning. WebSocket creation is injected so tests use a local fake without changing browser globals.

File names follow the Angular CLI convention used in this project: component files have short names, while injectable services and the store carry `.service` and `.store` suffixes. Signal Forms keep the form aligned with the application's zoneless signal state. The add-order form loads through `@defer` when opened.

The server renders the dashboard and loads its initial orders, instruments, and contract types through the existing REST API. Angular's built-in HTTP Transfer Cache passes those responses to the browser during hydration. The root element in `src/index.html` is empty; the visible initial dashboard comes from SSR. Theme DOM and storage access, and WebSocket initialization, run only in the browser. The server renders groups with their existing collapsed state; live quotes begin after hydration.

After the HTTP data loads, the store builds the order groups. Quotes update their profits in real time. Each symbol in the table shows whether its price is current, stale, or still awaited. The WebSocket connection sends a subscription probe every 30 seconds and reconnects if no valid quote or acknowledgement arrives within 10 seconds. If the connection drops, the application marks previously received prices as stale and attempts to reconnect; adding an order requires a fresh price for the selected symbol.

Adding an order waits for API confirmation before changing the view; refreshing the page loads the saved order from PostgreSQL. Closing orders changes only browser memory, so those orders reappear after a refresh. Only the theme preference is saved in `localStorage`.
