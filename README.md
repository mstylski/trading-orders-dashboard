# Trading Orders Dashboard

An Angular 22.2.1 application with server-side rendering (SSR) for viewing orders grouped by symbol. It shows position profits based on WebSocket quotes, lets you add or close orders locally, and supports light, dark, or system themes.

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

For an already migrated and seeded database, start PostgreSQL and run `npm run db:verify`; do not rerun the seed just to start the application. The seed replaces all three tables' contents in one transaction.

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

| Endpoint              | Data source           | Response                                                             |
| --------------------- | --------------------- | -------------------------------------------------------------------- |
| `GET /instruments`    | PostgreSQL via Prisma | 108 `{ symbol, contractType }` records ordered by symbol             |
| `GET /orders`         | PostgreSQL via Prisma | `{ data }` containing all 213 open orders, without pagination        |
| `GET /contract-types` | PostgreSQL via Prisma | 6 `{ contractType, contractSize }` records ordered by `contractType` |

`GET /orders` accepts an optional, case-insensitive `status=open|closed` query parameter. The current model contains open orders only and has no status column, so omitting the parameter or requesting `open` returns all orders, and `closed` returns `{ data: [] }`. Invalid or repeated status values return HTTP 400. Adding or closing orders in the dashboard changes browser memory only.

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

The repository includes a PostgreSQL 18.6 setup for SQL practice and Prisma ORM 7 for the backend data model. PostgreSQL is required for `GET /orders`, `GET /instruments`, `GET /contract-types` and the dashboard's initial data load; Docker is optional.

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
npm run format:check
npm run lint
npm run test:api
npm test -- --watch=false
npm run build
npm run db:verify
```

Angular tests use mocked HTTP and WebSocket responses. `test:api` builds the backend and starts NestJS on free local ports. It requires a running, migrated and seeded Prisma database configured by `DATABASE_URL`. The suite checks response formats, ordering, order status validation, Decimal conversion, current PostgreSQL records, database failures and timeouts. It creates temporary records and takes an exclusive table lock to exercise database access, then removes those records and releases the lock.

Both the HTTP contract suite (before starting NestJS) and the lock test accept only a PostgreSQL URL with a loopback host (`localhost`, `127.0.0.1` or `::1`) and a database named `trading_orders_prisma_dev`. Their shared guard rejects missing or malformed configuration and connection query overrides, including `?database=...`, before connecting or modifying data, without displaying credentials. Decimal regression cases cover `1e400`, `1e-400` and `9007199254740993`, including HTTP 500 and cleanup. API test files run serially. Do not run a seed or another API test suite concurrently. Tests do not reset, migrate or reseed the database; run `db:verify` before and afterwards to confirm the complete development snapshot.

For a browser check, keep the API on port 3000 and start the production SSR server on port 4000. With the seeded data, confirm 213 orders and 108 groups, open the add-order form, and check live quotes and profit updates. DevTools Console should have no hydration or unhandled application errors. During initial hydration, Network should show no repeated browser GETs to `/orders`, `/instruments` or `/contract-types`: Angular uses the responses embedded in the SSR transfer cache.

Database tests require a separately started and initialized PostgreSQL server: `npm run test:db -- --docker` uses Compose, while `npm run test:db` uses `psql` from `PATH` (or the `PSQL` executable path) and the `PGHOST`, `PGPORT`, `PGUSER`, `PGPASSWORD`, `PGDATABASE` connection variables. They run transactional constraint checks and compare all SQL records against the JSON fixtures, including exact decimals and millisecond timestamps. See [database testing instructions](db/README.md#repeatable-database-tests).

To run only the fixture comparison, use `npm run test:db:fixtures -- --docker` for Compose or `npm run test:db:fixtures` for a native server. Database tests do not reset or reseed the database.

Routine Prisma database verification uses `db:verify` without seeding. The [Prisma guide](api/prisma/README.md#generate-migrate-and-seed) explains initial setup and the seed's replacement strategy.

`lint` and both formatting commands cover the frontend, API and database test scripts, including API tests and build scripts. `lint:api` checks just the backend; `lint:db` checks the database test scripts. Angular-specific lint rules apply only to `src`.

## Structure and data flow

- `api` contains the NestJS HTTP endpoints, JSON fixtures, build scripts, and API tests. `api/src/prisma` provides the shared Prisma dependency through NestJS DI; the orders, instruments and contract-types services read and map their database records. `api/prisma` contains the Prisma client factory, schema, migrations, fixture seed and verification scripts for a separate database.
- `db` contains the standalone SQL schema, seed, example queries, and database tests; `compose.yaml` configures the PostgreSQL container.
- `src/app/features/orders/data` fetches and validates data from three HTTP endpoints and handles the WebSocket connection, symbol subscriptions, and reconnection.
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

Adding and closing orders changes only the state in browser memory. Refreshing the page fetches the initial data again. Only the theme preference is saved in `localStorage`.

## Sharing a source ZIP

On Windows, create a source archive with `npm run package:source`. The script packages the current source files, including uncommitted additions, into an ignored `tmp/trading-orders-source-*.zip` and validates the ZIP entries. It uses an explicit source allowlist and excludes `.env` files (except the root `.env.example`), common credential/key files, linked files/directories, dependencies, generated Prisma files, `dist/`, `.angular/`, `.idea/` and other local artifacts. Review source contents for any hardcoded secrets before sharing; `.gitignore` alone does not protect a manually created ZIP.

Keep `.env.example` free of credentials. If a password from an earlier archive was shared outside a trusted environment or reused elsewhere, rotate it in PostgreSQL and update the local `.env` and any other affected services.
