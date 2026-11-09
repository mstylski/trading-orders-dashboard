# Trading Orders Dashboard

An Angular 22.2.1 application with server-side rendering (SSR) for viewing orders grouped by symbol. It shows position profits based on WebSocket quotes, lets you add or close orders locally, and supports light, dark, or system themes.

## Getting started

Node.js 24 LTS (at least 24.15.0) and npm are required. Run all commands from the repository root unless noted otherwise. Install the dependencies:

```bash
npm install
```

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

The API serves copies of the original JSON data in `api/data`. `GET /orders` returns all matching orders as `{ data }`, with an optional `status=open|closed` query parameter. The source data contains open orders only, so `status=closed` returns an empty list. `GET /instruments` and `GET /contract-types` return the original arrays. Invalid status values return HTTP 400.

`npm run build:api` compiles the backend and copies its JSON files into `dist/api/data`. The API reads data relative to its module files, so the compiled artifact can run from another working directory without the source `api/data` folder. Node dependencies must still be installed. For example, from the project root:

```bash
npm run build:api
cd dist
node api/main.js
```

The API base URL is configured in `src/app/features/orders/data/orders-data.config.ts` for both SSR and the browser. Rebuild the dashboard after changing it. Angular HTTP transfer cache carries the SSR responses into hydration.

The SSR host allowlist in `angular.json` currently includes `localhost` and `127.0.0.1`. Add the deployment hostname before serving the application on another host.

## PostgreSQL

The repository includes an independent PostgreSQL 18.6 database for SQL practice. PostgreSQL and Docker are optional for running the dashboard and API. NestJS continues to serve the JSON fixtures; it has no database connection or Prisma dependency.

With Docker Desktop running (Linux containers), copy `.env.example` to `.env` and set a nonempty `POSTGRES_PASSWORD` before starting Compose. The local `.env` file is ignored by Git. You can also supply the password through an environment variable; Compose rejects a missing or empty value.

```bash
docker compose up -d --wait
npm run test:db -- --docker
docker compose exec postgres psql -X -U trading -d trading_orders
```

Initialization creates `contract_types`, `instruments`, and `orders` with primary and foreign keys, then loads all 6 contract types, 108 instruments, and 213 orders from a SQL snapshot of `api/data`. See [the database guide](db/README.md) for the model, JOIN and GROUP BY queries, constraint verification, and a Windows setup without Docker.

Compose exposes PostgreSQL at `127.0.0.1:5432`, with database `trading_orders`, user `trading`, and the password configured above. Set `POSTGRES_PORT` to change the host port. The `postgres_data` volume preserves data across stops; initialization scripts run only when the data directory is empty, so editing them does not update an existing database. Versioned migrations are planned for the NestJS/database integration; see [the migration plan](db/README.md#schema-changes-in-the-next-stage).

## Verifying the project

```bash
npm run build
npm test -- --watch=false
npm run test:api
npm run lint
npm run format:check
```

Angular tests use mocked HTTP and WebSocket responses. `test:api` builds the backend and uses the Node test runner to start the real NestJS module on a free local port, with `dist/api` as its working directory. It checks all three HTTP endpoints against the source fixtures, status filtering, invalid queries, and recovery after validation errors. The server closes after the tests. No additional test dependencies are required.

Database tests require a separately started and initialized PostgreSQL server: `npm run test:db -- --docker` uses Compose, while `npm run test:db` uses `psql` from `PATH` (or the `PSQL` executable path) and the `PGHOST`, `PGPORT`, `PGUSER`, `PGPASSWORD`, `PGDATABASE` connection variables. They run transactional constraint checks and compare all SQL records against the JSON fixtures, including exact decimals and millisecond timestamps. See [database testing instructions](db/README.md#repeatable-database-tests).

To run only the fixture comparison, use `npm run test:db:fixtures -- --docker` for Compose or `npm run test:db:fixtures` for a native server. Database tests do not reset or reseed the database.

`lint` and both formatting commands cover the frontend, API and database test scripts, including API tests and build scripts. `lint:api` checks just the backend; `lint:db` checks the database test scripts. Angular-specific lint rules apply only to `src`.

## Structure and data flow

- `api` contains the NestJS HTTP endpoints, JSON fixtures, build scripts, and API tests.
- `db` contains the independent PostgreSQL schema, seed, example queries, and database tests; `compose.yaml` configures its container.
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
git archive --format=zip --output=review.zip HEAD
```

This includes committed files only; uncommitted changes and untracked files are omitted. Generated output, local database files, dependencies, IDE workspace files, and `.env` must stay untracked. Check the archive contents before sharing; `dist/`, `.angular/cache/`, and `.idea/workspace.xml` should be absent.
