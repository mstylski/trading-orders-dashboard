import 'dotenv/config';
import { expect, Page, test } from '@playwright/test';
import { execFile } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { promisify } from 'node:util';
import { Pool } from 'pg';
import { testDatabaseUrl } from './test-database';

const databaseUrl = testDatabaseUrl();
const ordersUrl = 'http://localhost:3000/orders';
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

interface SavedOrder {
  id: number;
  symbol: string;
  side: string;
  size: number;
  openPrice: number;
  openTime: number;
  swap: number;
}

interface CapturedCreation {
  order: SavedOrder;
  status: number;
  input: unknown;
  key: string | undefined;
}

async function cleanupCreationKeys(keys: readonly string[]): Promise<void> {
  if (!keys.length) return;
  const pool = new Pool({ connectionString: databaseUrl });
  try {
    // Locate only this test's orders, including commits whose response was lost.
    // The foreign key cascades removal of their idempotency registry entries.
    await pool.query(
      `DELETE FROM public.orders WHERE id IN (
        SELECT order_id FROM public.order_creations
        WHERE scope = $1 AND key = ANY($2::uuid[])
      )`,
      ['POST /orders', keys],
    );
    // Also remove an orphan reservation if a failing API implementation left one.
    await pool.query(
      'DELETE FROM public.order_creations WHERE scope = $1 AND key = ANY($2::uuid[])',
      ['POST /orders', keys],
    );
  } finally {
    await pool.end();
  }
}

async function verifySeedSnapshot(phase: string): Promise<void> {
  console.log(`Database ${phase}: checking all persisted values against fixtures (read only).`);
  // Run the same full comparison as db:verify, including decimals, timestamps and relations.
  // A nonzero exit rejects the hook and fails the suite; no npm shell or seed is involved.
  const { stdout } = await promisify(execFile)(
    process.execPath,
    ['--import', 'tsx', 'api/prisma/verify.ts'],
    {
      cwd: resolve(__dirname, '..'),
      env: { ...process.env, DATABASE_URL: databaseUrl },
      timeout: 20_000,
      windowsHide: true,
    },
  );
  console.log(stdout.trim());
}

test.beforeAll(async () => verifySeedSnapshot('before E2E'));
// Also runs after a failed browser assertion. Tests clean up only their own rows;
// these hooks compare the full snapshot without reseeding or resetting tables.
test.afterAll(async () => verifySeedSnapshot('after E2E'));

test('real API returns all seeded records from the three GET endpoints', async ({ request }) => {
  // This fixture has its own API context, outside browser Transfer Cache observation.
  const orders = await request.get('http://localhost:3000/orders');
  expect(orders.status(), 'GET /orders HTTP status').toBe(200);
  expect((await orders.json()).data, 'GET /orders records').toHaveLength(213);

  const instruments = await request.get('http://localhost:3000/instruments');
  expect(instruments.status(), 'GET /instruments HTTP status').toBe(200);
  expect(await instruments.json(), 'GET /instruments records').toHaveLength(108);

  const contractTypes = await request.get('http://localhost:3000/contract-types');
  expect(contractTypes.status(), 'GET /contract-types HTTP status').toBe(200);
  expect(await contractTypes.json(), 'GET /contract-types records').toHaveLength(6);
});

test('SSR data survives hydration without repeated REST requests and the form works', async ({
  page,
  context,
}) => {
  const initialPaths = new Set(['/orders', '/instruments', '/contract-types']);
  const repeatedGets: string[] = [];
  const writes: string[] = [];
  const hydrationErrors: string[] = [];
  const pageErrors: string[] = [];

  // Observe real requests from BEFORE navigation, including failed requests and query strings.
  // No routes, mocks or response interception: both SSR and the browser use the real API.
  context.on('request', (request) => {
    const url = new URL(request.url());
    if (request.method() === 'GET' && initialPaths.has(url.pathname)) {
      repeatedGets.push(request.url());
    }
    if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method())) {
      writes.push(`${request.method()} ${request.url()}`);
    }
  });
  page.on('pageerror', (error) => pageErrors.push(error.message));
  page.on('console', (message) => {
    if (['error', 'warning'].includes(message.type()) && /NG05\d+|hydrat/i.test(message.text())) {
      hydrationErrors.push(message.text());
    }
  });

  const response = await page.goto('/');
  expect(response, 'Main document response').not.toBeNull();
  expect(response!.status(), 'SSR HTTP status').toBe(200);
  expect(response!.headers()['content-type']).toContain('text/html');

  // Parse the ORIGINAL response, not page.content() or the already hydrated DOM.
  // This avoids matching 213/108 only inside the serialized transfer cache.
  const ssr = await page.evaluate(
    (html) => {
      const document = new DOMParser().parseFromString(html, 'text/html');
      return {
        orders: document.querySelector('[data-testid="orders-count"]')?.textContent?.trim(),
        groups: document.querySelector('[data-testid="groups-count"]')?.textContent?.trim(),
        groupRows: document.querySelectorAll('tr.group-row').length,
        hasBTCUSD: [...document.querySelectorAll('tr.group-row')].some((row) =>
          row.textContent?.includes('BTCUSD'),
        ),
        formPresent: document.querySelector('[data-testid="order-form"]') !== null,
      };
    },
    await response!.text(),
  );
  expect(ssr).toEqual({
    orders: '213',
    groups: '108 symboli',
    groupRows: 108,
    hasBTCUSD: true,
    formPresent: false,
  });

  await expect(page.getByTestId('orders-count')).toHaveText('213');
  await expect(page.getByTestId('groups-count')).toHaveText('108 symboli');

  const addOrder = page.getByTestId('add-order');
  // The SSR button is enabled before Angular attaches listeners. Retry the safe,
  // idempotent open action until its Angular state changes instead of sleeping.
  await expect(async () => {
    await addOrder.click();
    await expect(addOrder).toHaveAttribute('aria-expanded', 'true', { timeout: 500 });
  }).toPass({ timeout: 10_000 });
  await expect(page.getByTestId('order-form')).toBeVisible();
  await page.getByTestId('cancel-order').click();
  await expect(page.getByTestId('order-form')).toHaveCount(0);
  await expect(addOrder).toHaveAttribute('aria-expanded', 'false');
  await expect(addOrder).toBeFocused();
  await page.getByRole('button', { name: 'Rozwiń grupę BTCUSD', exact: true }).click();
  await expect(page.getByRole('row', { name: /1203384/ })).toBeVisible();
  await expect(page.getByTestId('orders-count')).toHaveText('213');
  await expect(page.getByTestId('groups-count')).toHaveText('108 symboli');

  // Let the browser finish rendering after the interaction. No networkidle:
  // the external quote WebSocket may stay active, reconnect or change prices.
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
      }),
  );
  expect(hydrationErrors, 'Hydration diagnostics from the browser console').toEqual([]);
  expect(pageErrors, 'Unhandled browser errors').toEqual([]);
  expect(repeatedGets, 'Initial SSR GETs must come from Transfer Cache in the browser').toEqual([]);
  expect(writes, 'The browser flow must be read only').toEqual([]);
});

async function openFilledOrderForm(
  page: Page,
  bid: () => number | null = () => 67250.25,
): Promise<void> {
  // The quote server is outside the write/HTTP contract under test. Reply to
  // subscriptions locally so a disconnected external service cannot hide the form action.
  await page.routeWebSocket('wss://webquotes.geeksoft.pl/websocket/quotes', (socket) => {
    socket.onMessage((message) => {
      const subscription = JSON.parse(message.toString()) as { p: string; d: string[] };
      if (subscription.p !== '/subscribe/addlist') return;
      socket.send(JSON.stringify({ p: '/subscribe/addlist', i: 1 }));
      const price = bid();
      if (price === null) return;
      socket.send(
        JSON.stringify({
          p: '/quotes/subscribed',
          d: subscription.d.map((symbol) => ({
            s: symbol,
            b: price,
            a: price + 1,
            t: Date.now() / 1000,
          })),
        }),
      );
    });
  });
  await page.goto('/');
  const addOrder = page.getByTestId('add-order');
  await expect(async () => {
    await addOrder.click();
    await expect(addOrder).toHaveAttribute('aria-expanded', 'true', { timeout: 500 });
  }).toPass({ timeout: 10_000 });
  // Opening the panel starts a lazy import; wait for its view before editing.
  await expect(page.getByTestId('order-form')).toBeVisible();
  await page.getByLabel('Symbol', { exact: true }).selectOption('BTCUSD');
  await page.getByLabel('Strona', { exact: true }).selectOption('SELL');
  await page.getByLabel('Wolumen', { exact: true }).fill('0,125');
  await expect(
    page.getByTestId('order-form').getByRole('button', { name: 'Dodaj zlecenie', exact: true }),
  ).toBeEnabled();
}

test('the form leaves the opening time to the server', async ({ page }) => {
  const posts: string[] = [];
  page.on('request', (request) => {
    if (request.method() === 'POST' && request.url() === ordersUrl) posts.push(request.url());
  });
  await openFilledOrderForm(page);
  const submit = page
    .getByTestId('order-form')
    .getByRole('button', { name: 'Dodaj zlecenie', exact: true });
  await expect(page.locator('#order-time')).toHaveCount(0);
  await expect(page.getByLabel('Czas otwarcia', { exact: true })).toHaveCount(0);
  await expect(submit).toBeEnabled();
  expect(posts).toEqual([]);
});

test('an order appears only after the real POST response and survives a production SSR reload', async ({
  page,
  request,
}) => {
  let releaseResponse!: () => void;
  const responseGate = new Promise<void>((resolve) => {
    releaseResponse = resolve;
  });
  let resolveSaved!: (value: CapturedCreation) => void;
  let rejectSaved!: (error: unknown) => void;
  const saved = new Promise<CapturedCreation>((resolve, reject) => {
    resolveSaved = resolve;
    rejectSaved = reject;
  });
  const createdKeys = new Set<string>();

  await page.route('http://localhost:3000/orders', async (route) => {
    if (route.request().method() !== 'POST') {
      await route.continue();
      return;
    }
    const key = route.request().headers()['idempotency-key'];
    if (key) createdKeys.add(key);
    try {
      const response = await route.fetch();
      const body = (await response.json()) as { data: SavedOrder };
      resolveSaved({
        order: body.data,
        status: response.status(),
        input: route.request().postDataJSON(),
        key,
      });
      // PostgreSQL has committed, but the browser has not received confirmation.
      await responseGate;
      await route.fulfill({ response });
    } catch (error) {
      rejectSaved(error);
      await route.abort();
    }
  });

  try {
    await openFilledOrderForm(page);
    const beforeSubmit = Date.now();
    await page
      .getByTestId('order-form')
      .getByRole('button', { name: 'Dodaj zlecenie', exact: true })
      .click();
    const { order, status, input, key } = await saved;
    expect(status).toBe(201);
    expect(key, 'Each new order carries a UUID idempotency key').toMatch(uuidPattern);
    expect(input).toEqual({
      symbol: 'BTCUSD',
      side: 'SELL',
      size: 0.125,
      openPrice: 67250.25,
    });
    expect(order).toMatchObject({ ...(input as object), swap: 0 });
    expect(Number.isSafeInteger(order.id)).toBe(true);
    expect(Number.isSafeInteger(order.openTime)).toBe(true);
    expect(order.openTime).toBeGreaterThanOrEqual(beforeSubmit);
    expect(order.openTime).toBeLessThanOrEqual(Date.now());
    const displayedTime = await page.evaluate((timestamp) => {
      const date = new Date(timestamp);
      const pad = (value: number) => String(value).padStart(2, '0');
      return `${pad(date.getDate())}.${pad(date.getMonth() + 1)}.${date.getFullYear()} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
    }, order.openTime);
    await expect(page.getByTestId('orders-count')).toHaveText('213');
    await expect(page.getByTestId('order-form')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Zapisywanie…', exact: true })).toBeDisabled();
    await expect(page.getByTestId('cancel-order')).toBeDisabled();
    releaseResponse();

    await expect(page.getByTestId('orders-count')).toHaveText('214');
    await expect(page.getByTestId('order-form')).toHaveCount(0);
    await expect(page.getByRole('row', { name: new RegExp(`\\b${order.id}\\b`) })).toBeVisible();
    await expect(
      page.getByRole('row', { name: new RegExp(`\\b${order.id}\\b`) }).locator('.date'),
    ).toHaveText(displayedTime);
    const persisted = await request.get('http://localhost:3000/orders');
    expect(persisted.status()).toBe(200);
    expect((await persisted.json()).data).toContainEqual(order);
    const reloaded = await page.reload();
    expect(reloaded?.status()).toBe(200);
    await expect(page.getByTestId('orders-count')).toHaveText('214');
    const serverCount = await page.evaluate(
      (html) =>
        new DOMParser()
          .parseFromString(html, 'text/html')
          .querySelector('[data-testid="orders-count"]')
          ?.textContent?.trim(),
      await reloaded!.text(),
    );
    expect(serverCount, 'A fresh production SSR document includes the persisted order').toBe('214');
    await expect(async () => {
      await page.getByRole('button', { name: 'Rozwiń grupę BTCUSD', exact: true }).click();
      await expect(
        page.getByRole('button', { name: 'Zwiń grupę BTCUSD', exact: true }),
      ).toHaveAttribute('aria-expanded', 'true', { timeout: 500 });
    }).toPass({ timeout: 10_000 });
    await expect(
      page.getByRole('row', { name: new RegExp(`\\b${order.id}\\b`) }).locator('.date'),
    ).toHaveText(displayedTime);
  } finally {
    releaseResponse();
    try {
      if (!page.isClosed()) await page.unrouteAll({ behavior: 'wait' });
    } finally {
      await cleanupCreationKeys([...createdKeys]);
    }
  }
});

test('a real API rejection leaves the form open and never adds a client-only order', async ({
  page,
  request,
}) => {
  await page.route('http://localhost:3000/orders', async (route) => {
    if (route.request().method() !== 'POST') {
      await route.continue();
      return;
    }
    // Simulate an instrument disappearing after the initial data load. The real
    // Nest endpoint supplies the error and must not insert an order.
    const response = await route.fetch({
      postData: { ...route.request().postDataJSON(), symbol: 'E2E_UNKNOWN_INSTRUMENT' },
    });
    await route.fulfill({ response });
  });

  await openFilledOrderForm(page);
  const rejected = page.waitForResponse(
    (response) =>
      response.url() === 'http://localhost:3000/orders' && response.request().method() === 'POST',
  );
  await page
    .getByTestId('order-form')
    .getByRole('button', { name: 'Dodaj zlecenie', exact: true })
    .click();
  expect((await rejected).status()).toBe(404);
  await expect(page.getByTestId('order-form')).toBeVisible();
  await expect(page.getByTestId('order-form').getByRole('alert')).toContainText(/.+/);
  await expect(page.getByTestId('orders-count')).toHaveText('213');
  await expect(page.getByLabel('Symbol', { exact: true })).toHaveValue('BTCUSD');
  await expect(page.getByLabel('Wolumen', { exact: true })).toHaveValue('0,125');
  await expect(page.locator('#order-time')).toHaveCount(0);
  await expect(
    page.getByTestId('order-form').getByRole('button', { name: 'Dodaj zlecenie', exact: true }),
  ).toBeEnabled();
  const persisted = await request.get('http://localhost:3000/orders');
  expect(persisted.status()).toBe(200);
  expect((await persisted.json()).data).toHaveLength(213);
});

test('concurrent POSTs with one idempotency key create exactly one persisted order', async ({
  request,
}) => {
  const key = randomUUID();
  const input = {
    symbol: 'BTCUSD',
    side: 'SELL',
    size: 0.125,
    openPrice: 67250.25,
  };

  try {
    // Wait for every request even when one fails, so cleanup cannot race an INSERT.
    const attempts = await Promise.allSettled(
      Array.from({ length: 5 }, () =>
        request.post(ordersUrl, {
          headers: { 'Idempotency-Key': key },
          data: input,
          timeout: 10_000,
        }),
      ),
    );
    const responses = attempts.map((attempt) => {
      if (attempt.status === 'rejected') throw attempt.reason;
      return attempt.value;
    });
    const bodies = await Promise.all(
      responses.map(async (response) => {
        expect(response.status()).toBe(201);
        return (await response.json()) as { data: SavedOrder };
      }),
    );
    for (const body of bodies) expect(body).toEqual(bodies[0]);
    expect(bodies[0].data).toMatchObject({ ...input, swap: 0 });
    expect(Number.isSafeInteger(bodies[0].data.id)).toBe(true);

    // A later replay has the same contract as the requests racing the first INSERT.
    const replay = await request.post(ordersUrl, {
      headers: { 'Idempotency-Key': key },
      data: input,
    });
    expect(replay.status()).toBe(201);
    expect(await replay.json()).toEqual(bodies[0]);
    const persisted = await request.get(ordersUrl);
    expect(persisted.status()).toBe(200);
    const orders = (await persisted.json()).data as SavedOrder[];
    expect(orders).toHaveLength(214);
    expect(orders.filter((order) => order.id === bodies[0].data.id)).toEqual([bodies[0].data]);
  } finally {
    await cleanupCreationKeys([key]);
  }
});

test('POST rejects client-assigned id and openTime without persisting an operation', async ({
  request,
}) => {
  const keys: string[] = [];
  const input = { symbol: 'BTCUSD', side: 'BUY', size: 0.125, openPrice: 67250.25 };
  try {
    for (const extra of [{ id: 99 }, { openTime: 0 }]) {
      const key = randomUUID();
      keys.push(key);
      const response = await request.post(ordersUrl, {
        headers: { 'Idempotency-Key': key },
        data: { ...input, ...extra },
      });
      expect(response.status()).toBe(400);
    }
    const pool = new Pool({ connectionString: databaseUrl });
    try {
      const persisted = await pool.query(
        'SELECT count(*)::int AS count FROM public.order_creations WHERE scope = $1 AND key = ANY($2::uuid[])',
        ['POST /orders', keys],
      );
      expect(persisted.rows).toEqual([{ count: 0 }]);
    } finally {
      await pool.end();
    }
    const orders = await request.get(ordersUrl);
    expect(orders.status()).toBe(200);
    expect((await orders.json()).data).toHaveLength(213);
  } finally {
    await cleanupCreationKeys(keys);
  }
});

test('a committed legacy pending survives closing and reload and resolves the original operation without another write', async ({
  page,
  request,
}) => {
  const key = randomUUID();
  const legacyRequest = {
    symbol: 'BTCUSD',
    side: 'SELL',
    size: 0.0000001,
    openPrice: 67250.25,
    openTime: Date.parse('2025-01-15T10:20:30.123Z'),
  };
  const requestHash = createHash('sha256').update(JSON.stringify(legacyRequest)).digest('hex');
  const pending = JSON.stringify({ key, request: legacyRequest });
  const pool = new Pool({ connectionString: databaseUrl });
  let order: SavedOrder;
  try {
    const client = await pool.connect();
    try {
      // Reproduce the durable result produced by the previous five-field contract.
      // Both rows commit together, just as they did in the previous API version.
      await client.query('BEGIN');
      const inserted = await client.query<{ id: string }>(
        `INSERT INTO public.orders (symbol, side, size, open_price, open_time, swap)
         VALUES ($1, $2, $3, $4, $5, 0) RETURNING id`,
        [
          legacyRequest.symbol,
          legacyRequest.side,
          legacyRequest.size,
          legacyRequest.openPrice,
          new Date(legacyRequest.openTime),
        ],
      );
      order = { id: Number(inserted.rows[0].id), ...legacyRequest, swap: 0 };
      expect(Number.isSafeInteger(order.id)).toBe(true);
      await client.query(
        `INSERT INTO public.order_creations
         (scope, key, request_hash, status_code, response_body, order_id)
         VALUES ($1, $2, $3, 201, $4::jsonb, $5)`,
        ['POST /orders', key, requestHash, JSON.stringify({ data: order }), order.id],
      );
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }

    const writes: string[] = [];
    page.on('request', (outgoing) => {
      if (outgoing.method() === 'POST' && outgoing.url() === ordersUrl) {
        writes.push(outgoing.url());
      }
    });
    await page.goto('/');
    await page.evaluate((stored) => {
      sessionStorage.setItem('trading-orders.pending-order.v1', stored);
    }, pending);
    await page.reload();
    const legacyPanel = page.getByTestId('legacy-pending');
    await expect(legacyPanel).toBeVisible();
    await expect(legacyPanel).toContainText(key);
    await expect(page.getByTestId('order-form')).toHaveCount(0);
    await expect(page.getByTestId('orders-count')).toHaveText('214');

    // Hiding and opening cannot replace a legacy operation with a fresh UUID.
    await legacyPanel.getByRole('button', { name: 'Zamknij formularz', exact: true }).click();
    await expect(legacyPanel).toHaveCount(0);
    expect(
      await page.evaluate(() => sessionStorage.getItem('trading-orders.pending-order.v1')),
    ).toBe(pending);
    await page.getByTestId('add-order').click();
    await expect(legacyPanel).toBeVisible();
    await expect(page.getByTestId('order-form')).toHaveCount(0);
    await page.reload();
    await expect(legacyPanel).toBeVisible();
    expect(
      await page.evaluate(() => sessionStorage.getItem('trading-orders.pending-order.v1')),
    ).toBe(pending);

    const resolved = page.waitForResponse(
      (response) =>
        response.url() === `${ordersUrl}/operations/${key}` &&
        response.request().method() === 'GET',
    );
    await legacyPanel.getByRole('button', { name: 'Sprawdź wynik zlecenia', exact: true }).click();
    const result = await resolved;
    expect(result.status()).toBe(201);
    expect(await result.json()).toEqual({ data: order });
    await expect(legacyPanel).toHaveCount(0);
    await expect(page.getByTestId('orders-count')).toHaveText('214');
    expect(
      await page.evaluate(() => sessionStorage.getItem('trading-orders.pending-order.v1')),
    ).toBeNull();
    expect(writes).toEqual([]);

    const persisted = await request.get(ordersUrl);
    expect(persisted.status()).toBe(200);
    const orders = (await persisted.json()).data as SavedOrder[];
    expect(orders).toHaveLength(214);
    expect(orders.filter((item) => item.id === order.id)).toEqual([order]);
    const registry = await pool.query(
      `SELECT request_hash, response_body,
         (SELECT count(*)::int FROM public.orders WHERE id = $1) AS orders,
         (SELECT count(*)::int FROM public.order_creations WHERE scope = $2 AND key = $3) AS creations
       FROM public.order_creations WHERE scope = $2 AND key = $3`,
      [order.id, 'POST /orders', key],
    );
    expect(registry.rows).toEqual([
      { request_hash: requestHash, response_body: { data: order }, orders: 1, creations: 1 },
    ]);

    await page.getByTestId('add-order').click();
    await expect(page.getByTestId('order-form')).toBeVisible();
    await expect(legacyPanel).toHaveCount(0);
  } finally {
    await pool.end();
    await cleanupCreationKeys([key]);
  }
});

for (const scenario of [
  { recovery: 'close and reopen', size: '0,125', value: 0.125, quotes: true },
  { recovery: 'reload', size: '0,125', value: 0.125, quotes: true },
  { recovery: 'reload', size: '0,0000001', value: 0.0000001, quotes: false },
]) {
  test(`a lost POST response survives ${scenario.recovery} for size ${scenario.size} with the original request`, async ({
    page,
    request,
  }) => {
    let currentBid: number | null = 67250.25;
    const sentBids = new Set<number>();
    const keys = new Set<string>();
    const attempts: CapturedCreation[] = [];
    let resolveCommitted!: (creation: CapturedCreation) => void;
    let rejectCommitted!: (error: unknown) => void;
    const committed = new Promise<CapturedCreation>((resolve, reject) => {
      resolveCommitted = resolve;
      rejectCommitted = reject;
    });

    await page.route(ordersUrl, async (route) => {
      if (route.request().method() !== 'POST') {
        await route.continue();
        return;
      }
      const key = route.request().headers()['idempotency-key'];
      if (key) keys.add(key);
      try {
        const response = await route.fetch();
        const body = (await response.json()) as { data: SavedOrder };
        const creation: CapturedCreation = {
          order: body.data,
          status: response.status(),
          input: route.request().postDataJSON(),
          key,
        };
        attempts.push(creation);
        if (attempts.length === 1) {
          // The real server committed; only its response to the browser is lost.
          await route.abort('connectionreset');
          resolveCommitted(creation);
        } else {
          await route.fulfill({ response });
        }
      } catch (error) {
        rejectCommitted(error);
        await route.abort();
      }
    });

    try {
      await openFilledOrderForm(page, () => {
        if (currentBid !== null) sentBids.add(currentBid);
        return currentBid;
      });
      await page.getByLabel('Wolumen', { exact: true }).fill(scenario.size);
      await page
        .getByTestId('order-form')
        .getByRole('button', { name: 'Dodaj zlecenie', exact: true })
        .click();
      const first = await committed;
      expect(first.status).toBe(201);
      expect(first.key).toMatch(uuidPattern);
      expect(first.order.openPrice).toBe(67250.25);
      expect(first.order.size).toBe(scenario.value);
      expect(first.input).toEqual({
        symbol: 'BTCUSD',
        side: 'SELL',
        size: scenario.value,
        openPrice: 67250.25,
      });
      expect(Number.isSafeInteger(first.order.openTime)).toBe(true);
      await expect(page.getByTestId('order-form').getByRole('alert')).toContainText(/.+/);
      await expect(page.getByTestId('orders-count')).toHaveText('213');

      const storedPending = await page.evaluate(() =>
        sessionStorage.getItem('trading-orders.pending-order.v1'),
      );
      expect(storedPending).not.toBeNull();
      if (!scenario.quotes) {
        // A changed browser clock cannot replace the server's persisted opening time.
        await page.clock.setFixedTime(new Date('2100-01-01T00:00:00Z'));
      }
      // Both close controls must hide only the panel, retaining the uncertain intent.
      for (const control of [
        page.getByRole('button', { name: 'Zamknij formularz', exact: true }),
        page.getByTestId('cancel-order'),
      ]) {
        await control.click();
        await expect(page.getByTestId('order-form')).toHaveCount(0);
        expect(
          await page.evaluate(() => sessionStorage.getItem('trading-orders.pending-order.v1')),
        ).toBe(storedPending);
        await page.getByTestId('add-order').click();
        await expect(page.getByTestId('order-form')).toBeVisible();
      }
      if (scenario.recovery === 'reload') {
        // SSR now includes the committed order; retry must not append it again.
        // The small-volume case deliberately receives no quotes after reload.
        currentBid = scenario.quotes ? 68250.25 : null;
        const reloaded = await page.reload();
        expect(reloaded?.status()).toBe(200);
        await expect(page.getByTestId('orders-count')).toHaveText('214');
      }
      await expect(page.getByTestId('order-form')).toBeVisible();
      if (scenario.recovery === 'reload' && scenario.quotes) {
        await expect.poll(() => sentBids.has(68250.25)).toBe(true);
      }
      await expect(page.getByLabel('Symbol', { exact: true })).toHaveValue('BTCUSD');
      await expect(page.getByLabel('Strona', { exact: true })).toHaveValue('SELL');
      await expect(page.getByLabel('Wolumen', { exact: true })).toHaveValue(scenario.size);
      await expect(page.locator('#order-time')).toHaveCount(0);
      for (const field of ['Symbol', 'Strona', 'Wolumen']) {
        await expect(page.getByLabel(field, { exact: true })).toBeDisabled();
      }
      const retryButton = page.getByTestId('retry-order');
      await expect(retryButton).toHaveText('Ponów potwierdzenie');
      await expect(retryButton).toBeEnabled();
      const retried = page.waitForResponse(
        (response) => response.url() === ordersUrl && response.request().method() === 'POST',
      );
      await retryButton.click();
      expect((await retried).status()).toBe(201);
      await expect(page.getByTestId('order-form')).toHaveCount(0);
      await expect(page.getByTestId('orders-count')).toHaveText('214');
      expect(attempts).toHaveLength(2);
      expect(attempts[1]).toEqual(first);
      expect([...keys]).toEqual([first.key]);

      const persisted = await request.get(ordersUrl);
      expect(persisted.status()).toBe(200);
      const orders = (await persisted.json()).data as SavedOrder[];
      expect(orders).toHaveLength(214);
      expect(orders.filter((order) => order.id === first.order.id)).toEqual([first.order]);
      const pool = new Pool({ connectionString: databaseUrl });
      try {
        const result = await pool.query(
          `SELECT (SELECT count(*)::int FROM public.orders WHERE id = $1) AS orders,
                (SELECT count(*)::int FROM public.order_creations WHERE scope = $2 AND key = $3) AS creations`,
          [first.order.id, 'POST /orders', first.key],
        );
        expect(result.rows).toEqual([{ orders: 1, creations: 1 }]);
      } finally {
        await pool.end();
      }
      await page.reload();
      await expect(page.getByTestId('orders-count')).toHaveText('214');
      await expect(page.getByTestId('order-form')).toHaveCount(0);
    } finally {
      try {
        if (!page.isClosed()) await page.unrouteAll({ behavior: 'wait' });
      } finally {
        // Keys are captured before POST, even if no successful response reaches the test.
        await cleanupCreationKeys([...keys]);
      }
    }
  });
}
