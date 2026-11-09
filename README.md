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

`GET /instruments` reads PostgreSQL through Prisma and returns the original array format: `{ symbol: string, contractType: number }`, ordered by symbol. The seeded database contains 108 instruments. `GET /orders` and `GET /contract-types` still read the JSON fixtures in `api/data`. Orders are returned as `{ data }`, with an optional `status=open|closed` query parameter. The source data contains open orders only, so `status=closed` returns an empty list. Invalid status values return HTTP 400.

| Endpoint              | Data source                    | Response                                                                    |
| --------------------- | ------------------------------ | --------------------------------------------------------------------------- |
| `GET /instruments`    | PostgreSQL via Prisma          | 108 `{ symbol, contractType }` records in the original fixture symbol order |
| `GET /orders`         | `api/data/order-data.json`     | `{ data }` containing 213 open orders                                       |
| `GET /contract-types` | `api/data/contract-types.json` | 6 `{ contractType, contractSize }` records                                  |

Only instrument reads have moved to PostgreSQL. Adding or closing orders in the dashboard still changes browser memory only.

The shared Prisma factory bounds PostgreSQL connection/handshake and pool checkout waits to **1,000 ms** (`connectionTimeoutMillis`) and each SQL statement to **2,000 ms** (`statement_timeout`). The latter is a PostgreSQL session setting: it cancels execution, including time spent waiting for a table lock, even if the HTTP caller disconnects. These fixed defaults leave about two seconds of margin against Angular's existing 5,000 ms HTTP timeout for a connection followed by a statement. They apply to the API, seed and verify, without new environment variables or a change to the seed's atomic transaction. Limits are per connection attempt/statement, not a total transaction deadline. A driver `query_timeout` would only bound the caller's wait; it is not a replacement for server cancellation and is not needed for these scenarios. Database failures return HTTP 500 with Nest's generic error body; there is no fixture or empty-array fallback. See [pg configuration](https://node-postgres.com/apis/client) and [PostgreSQL statement timeouts](https://www.postgresql.org/docs/18/runtime-config-client.html).

`npm run build:api` generates the Prisma client, compiles the backend and client into `dist/api`, and copies its JSON files into `dist/api/data`. The API reads fixtures relative to its module files, so the compiled artifact can run from another working directory without the source `api/data` folder. Node dependencies and `DATABASE_URL` are required at runtime. The local `.env` is loaded from the launch working directory; when launching elsewhere, supply `DATABASE_URL` through the environment. For example, with that variable already set, run from the project root:

```bash
npm run build:api
cd dist
node api/main.js
```

The API base URL is configured in `src/app/features/orders/data/orders-data.config.ts` for both SSR and the browser. Rebuild the dashboard after changing it. Angular HTTP transfer cache carries the SSR responses into hydration.

The SSR host allowlist in `angular.json` currently includes `localhost` and `127.0.0.1`. Add the deployment hostname before serving the application on another host.

## PostgreSQL

The repository includes a PostgreSQL 18.6 setup for SQL practice and Prisma ORM 7 for the backend data model. PostgreSQL is required for `GET /instruments` and the dashboard's initial data load; Docker is optional. The other two endpoints continue to serve JSON fixtures.

Follow [the Prisma guide](api/prisma/README.md) to create a separate empty `trading_orders_prisma_dev` database, apply the committed migration and explicitly run the repeatable seed. The schema and scripts live in `api/prisma`, with configuration in the root `prisma.config.ts`. Keep `DATABASE_URL` and its password in the ignored `.env`; the example configuration contains no secret. The initial migration must not target the existing manually initialized SQL database.

With Docker Desktop running (Linux containers), copy `.env.example` to `.env` and set a nonempty `POSTGRES_PASSWORD` before starting Compose. The local `.env` file is ignored by Git. You can also supply the password through an environment variable; Compose rejects a missing or empty value.

```bash
docker compose up -d --wait
npm run test:db -- --docker
docker compose exec postgres psql -X -U trading -d trading_orders
```

Initialization creates `contract_types`, `instruments`, and `orders` with primary and foreign keys, then loads all 6 contract types, 108 instruments, and 213 orders from a SQL snapshot of `api/data`. See [the database guide](db/README.md) for the model, JOIN and GROUP BY queries, constraint verification, and a Windows setup without Docker.

Compose exposes PostgreSQL at `127.0.0.1:5432`, with database `trading_orders`, user `trading`, and the password configured above. Set `POSTGRES_PORT` to change the host port. The `postgres_data` volume preserves data across stops; initialization scripts run only when the data directory is empty, so editing them does not update an existing database. Prisma migrations currently manage the separate stage 03 database; see [migration boundaries](db/README.md#prisma-migrations-in-stage-03).

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

Angular tests use mocked HTTP and WebSocket responses. `test:api` requires the running, migrated and seeded Prisma database configured by `DATABASE_URL`. It builds the backend and uses the Node test runner to start the real NestJS module on a free local port, with `dist/api` as its working directory. It compares all three HTTP responses with the source fixtures, checks all 108 instruments and selected symbols, and covers order status filtering and validation errors. It also inserts a unique temporary instrument, verifies that the endpoint returns it, and deletes it in cleanup to prove the response comes from the database. A database/query error or missing seed data fails the test. The server and Prisma connections close after the tests. No additional test dependencies are required.

The API suite contains 10 HTTP contract tests and 3 database deadline regression tests. The regressions use a controlled silent TCP server, a loopback port with no PostgreSQL listener, and an exclusive table lock in a separate PostgreSQL session. They require bounded HTTP failures, generic error bodies, unchanged fixture routes during an outage, cleanup of timed-out/aborted connections, and graceful application/process shutdown. The lock test checks `pg_stat_activity` to confirm SQL has stopped while the lock is still held, including after an HTTP abort. It rolls back in `finally`, then requires the next request to return the original 108 instruments.

The lock test accepts only a loopback host (`localhost`, `127.0.0.1` or `::1`) and a database named `trading_orders_prisma_dev` in `DATABASE_URL`. Test files run serially so the lock scenario cannot interfere with the temporary-instrument test. Do not run a seed or another API test suite concurrently. Timing assertions allow 1,500 ms of scheduling/HTTP overhead above the database limits. Test requests use `Connection: close` to measure database shutdown independently of the HTTP keep-alive idle timeout. These tests do not reset, migrate or reseed the database. Run the final `db:verify` after all tests to confirm the complete 6/108/213 snapshot and cleanup.

For a browser check, keep the API on port 3000 and start the production SSR server on port 4000 as above. Open a fresh page with DevTools recording Console and Network before navigation. Confirm 213 orders, 108 groups and BTCUSD, open the add-order form, and verify that Console has no `NG050x` hydration errors or unhandled application errors. Network must show no browser `GET /orders`, `/instruments` or `/contract-types` during initial hydration: the responses are in the SSR HTML's `ng-state` transfer cache. Check the WebSocket connection and subscription messages separately. A raw HTML fetch or an Angular unit test alone does not verify hydration.

The production Chrome check on 2026-11-09 confirmed these criteria: HTTP 200, 213 orders and 108 groups, an interactive add-order form with a live BTCUSD quote, no hydration or unhandled application errors, and zero repeated browser GETs to the three REST endpoints. The transfer cache contained 213 orders, 108 instruments and 6 contract types. A temporary PostgreSQL-only instrument also appeared in the transfer cache on a fresh navigation and was removed in `finally`; the final database verification returned 6/108/213. The existing WebSocket opened and exchanged subscription/heartbeat and quote messages without errors during observation. This check used the current frontend/SSR build with the user's existing local API process; timeout regressions separately ran the freshly compiled API in isolated child processes.

Database tests require a separately started and initialized PostgreSQL server: `npm run test:db -- --docker` uses Compose, while `npm run test:db` uses `psql` from `PATH` (or the `PSQL` executable path) and the `PGHOST`, `PGPORT`, `PGUSER`, `PGPASSWORD`, `PGDATABASE` connection variables. They run transactional constraint checks and compare all SQL records against the JSON fixtures, including exact decimals and millisecond timestamps. See [database testing instructions](db/README.md#repeatable-database-tests).

To run only the fixture comparison, use `npm run test:db:fixtures -- --docker` for Compose or `npm run test:db:fixtures` for a native server. Database tests do not reset or reseed the database.

For first-time setup of the separate Prisma database, use `npm run db:generate`, `npm run db:typecheck`, `npm run db:migrate`, `npm run db:seed` and `npm run db:verify` with the local `DATABASE_URL`. Repeating seed and verification is an optional reproducibility check on a disposable development snapshot; it replaces any additional records. Routine verification uses `db:verify` without seeding. The [Prisma guide](api/prisma/README.md#generate-migrate-and-seed) explains the commands and the seed's replacement strategy.

`lint` and both formatting commands cover the frontend, API and database test scripts, including API tests and build scripts. `lint:api` checks just the backend; `lint:db` checks the database test scripts. Angular-specific lint rules apply only to `src`.

## Structure and data flow

- `api` contains the NestJS HTTP endpoints, JSON fixtures, build scripts, and API tests. `api/src/prisma` provides the shared Prisma dependency through NestJS DI; `api/src/instruments` reads and maps instrument records. `api/prisma` contains the Prisma client factory, schema, migrations, fixture seed and verification scripts for a separate database.
- `db` preserves the stage 02 SQL schema, seed, example queries, and database tests; `compose.yaml` configures the PostgreSQL container.
- `src/app/features/orders/data` fetches and validates data from three HTTP endpoints and handles the WebSocket connection, symbol subscriptions, and reconnection.
- `src/app/features/orders/state` stores orders and exposes signals and operations for adding and closing them. The store is scoped to the page and releases the connection when the page is destroyed.
- `src/app/features/orders/domain` contains pure calculations for contract values, profits, and groups.
- `src/app/features/orders/components` contains the form and table; `orders-page` connects them to the state.
- `src/app/core` stores the theme preference.
- `src/app/shared` contains the theme switcher, notifications, and reusable type guards.
- `src/main.server.ts`, `src/app/app.config.server.ts`, `src/app/app.routes.server.ts`, and `src/server.ts` configure the server bootstrap, server rendering route, and Node server.

The store owns orders, load status, and the selected form symbol needed for quote subscriptions. A computed set of symbols drives WebSocket subscriptions; the page owns expanded rows. The notification service owns message limits and timers. Domain functions return typed reason codes, which the presentation layer translates into Polish messages.

HTTP payloads are validated as a whole. An invalid record or duplicate key rejects the affected response and shows a retryable error instead of silently omitting a position. Socket messages are parsed independently; invalid quote rows are rejected before updating prices, while valid rows from the same message are still accepted. Rejected messages and rows produce console warnings that distinguish invalid structure, missing fields, and invalid values, with the affected field or row index. Quotes for symbols that are no longer subscribed are ignored without a warning. WebSocket creation is injected so tests use a local fake without changing browser globals.

File names follow the Angular CLI convention used in this project: component files have short names, while injectable services and the store carry `.service` and `.store` suffixes. Signal Forms keep the form aligned with the application's zoneless signal state.

The server renders the dashboard and loads its initial orders, instruments, and contract types through the existing REST API. Angular's built-in HTTP Transfer Cache passes those responses to the browser during hydration. The root element in `src/index.html` is empty; the visible initial dashboard comes from SSR. Theme DOM and storage access, and WebSocket initialization, run only in the browser. The server renders groups with their existing collapsed state; live quotes begin after hydration.

After the HTTP data loads, the store builds the order groups. Quotes update their profits in real time. Each symbol in the table shows whether its price is current, stale, or still awaited. The WebSocket connection sends a subscription probe every 30 seconds and reconnects if no valid quote or acknowledgement arrives within 10 seconds. If the connection drops, the application marks previously received prices as stale and attempts to reconnect; adding an order requires a fresh price for the selected symbol.

Adding and closing orders changes only the state in browser memory. Refreshing the page fetches the initial data again. Only the theme preference is saved in `localStorage`.

## Preparing a code review archive

After committing all files intended for review (including `db/` and `compose.yaml`), create an archive from the committed Git tree:

```bash
git ls-files -- .env node_modules dist .angular .idea api/prisma/generated
git archive --format=zip --output=review.zip HEAD
```

The `git ls-files` check must return no paths; stop and remove any listed local files from tracking before archiving (keep the local files). The archive includes committed files only; uncommitted changes and untracked files are omitted. Generated output, local database files, dependencies, IDE workspace files, and `.env` must stay untracked. `.gitattributes` excludes the tracked VS Code editor settings from the archive. Keep `review.zip` out of the Git index, and recreate it after committing further changes.

Verify the actual ZIP, not just the index. For example, in PowerShell:

```powershell
Add-Type -AssemblyName System.IO.Compression.FileSystem
$archive = [IO.Compression.ZipFile]::OpenRead((Join-Path $PWD 'review.zip'))
try {
  $entries = @($archive.Entries.FullName)
  $forbidden = @($entries | Where-Object {
    $_ -match '(^|/)(\.env|node_modules|dist|\.angular|\.idea|\.vscode)(/|$)' -or
    $_ -match '^api/prisma/generated(/|$)'
  })
  if ($forbidden.Count) { throw 'Archive contains local or generated files.' }
  foreach ($required in @('.env.example', 'package.json', 'package-lock.json',
    'api/data/instruments.json', 'api/data/order-data.json', 'api/data/contract-types.json',
    'api/prisma/schema.prisma', 'api/prisma/migrations/migration_lock.toml',
    'api/prisma/migrations/20261109000100_init/migration.sql',
    'api/src/instruments/instruments.service.ts', 'src/main.ts', 'src/main.server.ts')) {
    if ($required -notin $entries) { throw "Missing required file: $required" }
  }
  "Verified $($entries.Count) archive entries."
} finally {
  $archive.Dispose()
}
```

Keep all source files, fixtures, schema, migration history and lockfile. Git ignore rules do not filter a ZIP created by manually packing the project folder. Never share the local `.env` or copy its password into a review report.
