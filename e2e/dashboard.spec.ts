import 'dotenv/config';
import { expect, test } from '@playwright/test';
import { execFile } from 'node:child_process';
import { resolve } from 'node:path';
import { promisify } from 'node:util';

async function verifySeedSnapshot(phase: string): Promise<void> {
  console.log(`Database ${phase}: checking all persisted values against fixtures (read only).`);
  // Run the same full comparison as db:verify, including decimals, timestamps and relations.
  // A nonzero exit rejects the hook and fails the suite; no npm shell or seed is involved.
  const { stdout } = await promisify(execFile)(
    process.execPath,
    ['--import', 'tsx', 'api/prisma/verify.ts'],
    { cwd: resolve(__dirname, '..'), timeout: 20_000, windowsHide: true },
  );
  console.log(stdout.trim());
}

test.beforeAll(async () => verifySeedSnapshot('before E2E'));
// Also runs after a failed browser assertion. Never seed, migrate or write to the database.
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
