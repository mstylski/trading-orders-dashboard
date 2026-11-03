# Trading Orders Dashboard

An Angular 22.2.1 application with server-side rendering (SSR) for viewing orders grouped by symbol. It shows position profits based on WebSocket quotes, lets you add or close orders locally, and supports light, dark, or system themes.

## Getting started

Node.js 24 LTS (at least 24.15.0) and npm are required. Install the dependencies and start the development server:

```bash
npm install
npm start
```

The development application is available at `http://localhost:4200/`. For the production SSR server, build and run:

```bash
npm run build
npm run serve:ssr:trading-orders-dashboard
```

The production server listens at `http://localhost:4000/` by default. Set the `PORT` environment variable to use another port. The server needs access to the external GeekSoft REST endpoints to render order data; the browser needs access to the GeekSoft WebSocket endpoint for live quotes. The repository does not include a backend.

The SSR host allowlist in `angular.json` currently includes `localhost` and `127.0.0.1`. Add the deployment hostname before serving the application on another host.

## Verifying the project

```bash
npm run build
npm test -- --watch=false
npm run lint
npm run format:check
```

Unit and integration tests use mocked HTTP and WebSocket responses. No E2E test tool is configured for this project.

## Structure and data flow

- `src/app/features/orders/data` fetches and validates data from three HTTP endpoints and handles the WebSocket connection, symbol subscriptions, and reconnection.
- `src/app/features/orders/state` stores orders and exposes signals and operations for adding and closing them. The store is scoped to the page and releases the connection when the page is destroyed.
- `src/app/features/orders/domain` contains pure calculations for contract values, profits, and groups.
- `src/app/features/orders/components` contains the form and table; `orders-page` connects them to the state.
- `src/app/core` stores the theme preference.
- `src/app/shared` contains the theme switcher, notifications, and reusable type guards.
- `src/main.server.ts`, `src/app/app.config.server.ts`, `src/app/app.routes.server.ts`, and `src/server.ts` configure the server bootstrap, server rendering route, and Node server.

The store owns orders, load status, and the selected form symbol needed for quote subscriptions. A computed set of symbols drives WebSocket subscriptions; the page owns expanded rows. The notification service owns message limits and timers. Domain functions return typed reason codes, which the presentation layer translates into Polish messages.

HTTP payloads are validated as a whole. An invalid record or duplicate key rejects the affected response and shows a retryable error instead of silently omitting a position. Socket messages are parsed independently; invalid quote rows are ignored. WebSocket creation is injected so tests use a local fake without changing browser globals.

File names follow the Angular CLI convention used in this project: component files have short names, while injectable services and the store carry `.service` and `.store` suffixes. Signal Forms keep the form aligned with the application's zoneless signal state.

The server renders the dashboard and loads its initial orders, instruments, and contract types through the existing REST API. Angular's built-in HTTP Transfer Cache passes those responses to the browser during hydration. The root element in `src/index.html` is empty; the visible initial dashboard comes from SSR. Theme DOM and storage access, and WebSocket initialization, run only in the browser. The server renders groups with their existing collapsed state; live quotes begin after hydration.

After the HTTP data loads, the store builds the order groups. Quotes update their profits in real time. If the connection drops, the application marks the last prices as stale and attempts to reconnect; adding an order requires a fresh price for the selected symbol.

Adding and closing orders changes only the state in browser memory. Refreshing the page fetches the initial data again. Only the theme preference is saved in `localStorage`.
