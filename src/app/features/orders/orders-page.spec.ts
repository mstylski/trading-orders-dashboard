import { ComponentFixture, DeferBlockState, TestBed } from '@angular/core/testing';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { OrdersPage } from './orders-page';
import { appConfig } from '../../app.config';
import { ordersDataConfig } from './data/orders-data.config';
import { FakeSocket, testData } from './testing/fixtures';
import { QUOTE_SOCKET_FACTORY } from './data/quote-socket';
import { PENDING_ORDER_STORAGE_KEY } from './state/orders.store';

describe('Dashboard integration', () => {
  let fixture: ComponentFixture<OrdersPage>;
  let element: HTMLElement;
  let http: HttpTestingController;
  let socket: FakeSocket;
  beforeEach(() => {
    sessionStorage.removeItem(PENDING_ORDER_STORAGE_KEY);
    socket = new FakeSocket();
    TestBed.configureTestingModule({
      imports: [OrdersPage],
      providers: [
        ...appConfig.providers,
        provideHttpClientTesting(),
        { provide: QUOTE_SOCKET_FACTORY, useValue: () => socket },
      ],
    });
    fixture = TestBed.createComponent(OrdersPage);
    element = fixture.nativeElement as HTMLElement;
    http = TestBed.inject(HttpTestingController);
    fixture.detectChanges();
  });
  afterEach(() => {
    http.verify();
    sessionStorage.removeItem(PENDING_ORDER_STORAGE_KEY);
  });

  async function load(): Promise<void> {
    http.expectOne(`${ordersDataConfig.apiBaseUrl}/orders`).flush({ data: testData.orders });
    http.expectOne(`${ordersDataConfig.apiBaseUrl}/instruments`).flush(testData.instruments);
    http.expectOne(`${ordersDataConfig.apiBaseUrl}/contract-types`).flush(testData.contracts);
    await fixture.whenStable();
    socket.open();
    socket.quote();
    socket.quote('EURUSD', 1.1);
    await fixture.whenStable();
  }

  async function click(selector: string): Promise<void> {
    const button = element.querySelector<HTMLButtonElement>(selector);
    expect(button, selector).not.toBeNull();
    button!.click();
    await fixture.whenStable();
  }

  async function fill(selector: string, value: string): Promise<void> {
    const control = element.querySelector<HTMLInputElement | HTMLSelectElement>(selector)!;
    control.value = value;
    control.dispatchEvent(new Event('input', { bubbles: true }));
    if (control instanceof HTMLSelectElement)
      control.dispatchEvent(new Event('change', { bubbles: true }));
    await fixture.whenStable();
  }

  async function openForm(): Promise<void> {
    await click('.add-button');
    const blocks = await fixture.getDeferBlocks();
    expect(blocks).toHaveLength(1);
    await blocks[0].render(DeferBlockState.Complete);
    await fixture.whenStable();
  }

  it('preserves an older operation through closing and recreation, then confirms its original result', async () => {
    await load();
    fixture.destroy();
    const key = '28d0f7ed-7330-44c4-8b0e-83c29a43e3c2';
    const request = {
      symbol: 'BTCUSD',
      side: 'BUY',
      size: 0.0000001,
      openPrice: 111,
      openTime: 1750444222123,
    };
    const stored = JSON.stringify({ key, request });
    sessionStorage.setItem(PENDING_ORDER_STORAGE_KEY, stored);
    async function recreate(): Promise<void> {
      socket = new FakeSocket();
      fixture = TestBed.createComponent(OrdersPage);
      element = fixture.nativeElement as HTMLElement;
      fixture.detectChanges();
      await load();
    }
    await recreate();
    expect(element.querySelector('[data-testid=legacy-pending]')?.textContent).toContain(key);
    expect(element.querySelector('app-order-form')).toBeNull();
    await click('[aria-label="Zamknij formularz"]');
    expect(sessionStorage.getItem(PENDING_ORDER_STORAGE_KEY)).toBe(stored);
    await click('[data-testid=add-order]');
    expect(element.querySelector('[data-testid=legacy-pending]')).not.toBeNull();
    expect(element.querySelector('app-order-form')).toBeNull();
    fixture.destroy();
    await recreate();
    expect(sessionStorage.getItem(PENDING_ORDER_STORAGE_KEY)).toBe(stored);
    await click('[data-testid=legacy-pending] .button.primary');
    const lookup = http.expectOne({
      method: 'GET',
      url: `${ordersDataConfig.apiBaseUrl}/orders/operations/${key}`,
    });
    lookup.flush({ data: { ...request, id: 91, swap: 0 } }, { status: 201, statusText: 'Created' });
    await fixture.whenStable();
    expect(element.querySelector('[data-testid=legacy-pending]')).toBeNull();
    expect(sessionStorage.getItem(PENDING_ORDER_STORAGE_KEY)).toBeNull();
    expect(element.querySelector('[data-testid=orders-count]')?.textContent).toBe('4');
    expect(element.querySelector('.notification p')?.textContent).toBe(
      'Potwierdzono zlecenie nr 91',
    );
    http.expectNone((httpRequest) => httpRequest.method === 'POST');
  });

  it('shows loading, then collapsed groups and preserves multiple expanded groups across ticks', async () => {
    expect(element.textContent).toContain('Ładowanie zleceń');
    await load();
    expect(element.querySelector('h1')?.textContent).toBe('Otwarte zlecenia');
    expect(element.querySelectorAll('.group-row')).toHaveLength(2);
    expect(element.querySelectorAll('.order-row')).toHaveLength(0);
    await click('[aria-label="Rozwiń grupę BTCUSD"]');
    await click('[aria-label="Rozwiń grupę EURUSD"]');
    expect(element.querySelectorAll('.order-row')).toHaveLength(3);
    const row = element.querySelector('.order-row');
    socket.quote('BTCUSD', 111);
    await fixture.whenStable();
    expect(element.querySelectorAll('.order-row')).toHaveLength(3);
    expect(element.querySelector('.order-row')).toBe(row);
    expect(socket.sent).toHaveLength(1);
  });

  it('closes a group and individual order with the exact notifications and empty state', async () => {
    await load();
    await click('[aria-label="Zamknij grupę BTCUSD"]');
    expect(element.querySelector('.notification p')?.textContent).toBe(
      'Zamknięto zlecenie nr 10, 20',
    );
    await click('[aria-label="Rozwiń grupę EURUSD"]');
    await click('[aria-label="Zamknij zlecenie nr 11"]');
    expect(element.textContent).toContain('Zamknięto zlecenie nr 11');
    expect(element.textContent).toContain('Brak otwartych zleceń');
    await click('[aria-label="Zamknij powiadomienie"]');
    expect(element.querySelectorAll('.notification')).toHaveLength(1);
  });

  it('dismisses each notification four seconds after it appears', async () => {
    await load();
    vi.useFakeTimers();
    try {
      element.querySelector<HTMLButtonElement>('[aria-label="Zamknij grupę BTCUSD"]')!.click();
      fixture.detectChanges();
      expect(element.querySelectorAll('.notification')).toHaveLength(1);

      vi.advanceTimersByTime(2_000);
      element.querySelector<HTMLButtonElement>('[aria-label="Zamknij grupę EURUSD"]')!.click();
      fixture.detectChanges();
      expect(element.querySelectorAll('.notification')).toHaveLength(2);

      vi.advanceTimersByTime(1_999);
      fixture.detectChanges();
      expect(element.querySelectorAll('.notification')).toHaveLength(2);

      vi.advanceTimersByTime(1);
      fixture.detectChanges();
      expect(element.querySelectorAll('.notification')).toHaveLength(1);
      expect(element.querySelector('.notification p')?.textContent).toBe(
        'Zamknięto zlecenie nr 11',
      );

      vi.advanceTimersByTime(2_000);
      fixture.detectChanges();
      expect(element.querySelectorAll('.notification')).toHaveLength(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it('cancels notification timers when dismissed or the page is destroyed', async () => {
    await load();
    vi.useFakeTimers();
    try {
      element.querySelector<HTMLButtonElement>('[aria-label="Zamknij grupę BTCUSD"]')!.click();
      fixture.detectChanges();
      expect(vi.getTimerCount()).toBe(1);

      element.querySelector<HTMLButtonElement>('[aria-label="Zamknij powiadomienie"]')!.click();
      fixture.detectChanges();
      expect(vi.getTimerCount()).toBe(0);

      element.querySelector<HTMLButtonElement>('[aria-label="Zamknij grupę EURUSD"]')!.click();
      fixture.detectChanges();
      expect(vi.getTimerCount()).toBe(1);
      fixture.destroy();
    } finally {
      vi.useRealTimers();
    }
  });

  it('adds through Signal Forms after all groups are closed and expands the recreated group', async () => {
    await load();
    await click('[aria-label="Zamknij grupę BTCUSD"]');
    await click('[aria-label="Zamknij grupę EURUSD"]');
    await openForm();
    expect(element.querySelectorAll('#order-symbol option')).toHaveLength(3);
    await fill('#order-symbol', 'BTCUSD');
    await fill('#order-size', '0.05');
    expect(element.querySelector('#order-time')).toBeNull();
    expect(element.querySelector<HTMLButtonElement>('button[type=submit]')!.disabled).toBe(true);
    socket.quote('BTCUSD', 115);
    await fixture.whenStable();
    expect(element.querySelector<HTMLButtonElement>('button[type=submit]')!.disabled).toBe(false);
    element.querySelector<HTMLButtonElement>('button[type=submit]')!.click();
    fixture.detectChanges();
    expect(element.querySelector('app-order-form')).not.toBeNull();
    expect(element.querySelectorAll('.order-row')).toHaveLength(0);
    expect(element.querySelector<HTMLButtonElement>('[data-testid=retry-order]')!.disabled).toBe(
      true,
    );
    const request = http.expectOne({
      method: 'POST',
      url: `${ordersDataConfig.apiBaseUrl}/orders`,
    });
    expect(request.request.body).toEqual({
      symbol: 'BTCUSD',
      side: 'BUY',
      size: 0.05,
      openPrice: 115,
    });
    expect(request.request.body).not.toHaveProperty('openTime');
    request.flush(
      {
        data: {
          symbol: 'BTCUSD',
          side: 'BUY',
          size: 0.05,
          openPrice: 115,
          id: 21,
          openTime: 1750444222000,
          swap: 0,
        },
      },
      { status: 201, statusText: 'Created' },
    );
    await fixture.whenStable();
    expect(element.querySelector('app-order-form')).toBeNull();
    expect(element.querySelector('.group-toggle')?.getAttribute('aria-expanded')).toBe('true');
    expect(element.querySelectorAll('.order-row')).toHaveLength(1);
    expect(element.querySelector('.order-id')?.textContent).toBe('21');
    expect(element.querySelector('.order-row')?.textContent).toContain('115');
    expect(element.textContent).toContain('Dodano zlecenie nr 21');
  });

  it('keeps the form and existing rows after a rejected write, then permits retry', async () => {
    await load();
    await openForm();
    await fill('#order-symbol', 'BTCUSD');
    await fill('#order-size', '0.05');
    element.querySelector<HTMLButtonElement>('button[type=submit]')!.click();
    fixture.detectChanges();
    http
      .expectOne({ method: 'POST', url: `${ordersDataConfig.apiBaseUrl}/orders` })
      .flush({ message: 'Unknown instrument' }, { status: 404, statusText: 'Not Found' });
    await fixture.whenStable();
    expect(element.querySelector('app-order-form')).not.toBeNull();
    expect(element.querySelector('app-order-form [role=alert]')?.textContent).toContain(
      'instrument nie istnieje',
    );
    expect(element.querySelector('[data-testid=orders-count]')?.textContent).toBe('3');
    expect(element.textContent).not.toContain('Dodano zlecenie');
    expect(element.querySelector<HTMLButtonElement>('button[type=submit]')!.disabled).toBe(false);
  });

  it.each(['[data-testid=cancel-order]', '[aria-label="Zamknij formularz"]'])(
    'keeps an uncertain attempt after closing with %s and reopens its exact snapshot',
    async (closeSelector) => {
      await load();
      await openForm();
      await fill('#order-symbol', 'BTCUSD');
      await fill('#order-size', '0.05');
      element.querySelector<HTMLButtonElement>('button[type=submit]')!.click();
      fixture.detectChanges();
      const request = http.expectOne({
        method: 'POST',
        url: `${ordersDataConfig.apiBaseUrl}/orders`,
      });
      const originalKey = request.request.headers.get('Idempotency-Key');
      const originalBody = request.request.body;
      request.error(new ProgressEvent('error'));
      await fixture.whenStable();
      const pending = sessionStorage.getItem(PENDING_ORDER_STORAGE_KEY);
      expect(pending).not.toBeNull();
      await click(closeSelector);
      expect(element.querySelector('app-order-form')).toBeNull();
      expect(sessionStorage.getItem(PENDING_ORDER_STORAGE_KEY)).toBe(pending);
      await openForm();
      expect(element.querySelector<HTMLInputElement>('#order-size')?.value).toBe('0,05');
      expect(element.querySelector<HTMLInputElement>('#order-size')?.disabled).toBe(true);
      expect(element.querySelector<HTMLSelectElement>('#order-symbol')?.disabled).toBe(true);
      socket.quote('BTCUSD', 999);
      socket.fail();
      await fixture.whenStable();
      await click('[data-testid=retry-order]');
      const retry = http.expectOne({
        method: 'POST',
        url: `${ordersDataConfig.apiBaseUrl}/orders`,
      });
      expect(retry.request.headers.get('Idempotency-Key')).toBe(originalKey);
      expect(retry.request.body).toEqual(originalBody);
      retry.flush(
        { data: { ...originalBody, id: 91, openTime: 1750444222000, swap: 0 } },
        { status: 201, statusText: 'Created' },
      );
      await fixture.whenStable();
      expect(element.querySelectorAll('.order-id')).toHaveLength(3);
      expect(element.querySelector('[data-testid=orders-count]')?.textContent).toBe('4');
      expect(sessionStorage.getItem(PENDING_ORDER_STORAGE_KEY)).toBeNull();
      expect(element.querySelector('app-order-form')).toBeNull();
    },
  );
  it.each([0.0000001, 0.125, 1e21])(
    'automatically reopens a persisted volume %s after browser rendering',
    async (size) => {
      await load();
      fixture.destroy();
      const request = {
        symbol: 'BTCUSD',
        side: 'SELL',
        size,
        openPrice: 67250.25,
      };
      sessionStorage.setItem(
        PENDING_ORDER_STORAGE_KEY,
        JSON.stringify({
          key: '28d0f7ed-7330-44c4-8b0e-83c29a43e3c2',
          request,
        }),
      );
      socket = new FakeSocket();
      fixture = TestBed.createComponent(OrdersPage);
      element = fixture.nativeElement as HTMLElement;
      fixture.detectChanges();
      await load();
      const blocks = await fixture.getDeferBlocks();
      expect(blocks).toHaveLength(1);
      await blocks[0].render(DeferBlockState.Complete);
      await fixture.whenStable();
      expect(element.querySelector('.add-button')?.getAttribute('aria-expanded')).toBe('true');
      expect(element.querySelector<HTMLInputElement>('#order-size')?.disabled).toBe(true);
      expect(element.querySelector('#order-time')).toBeNull();
      socket.fail();
      await fixture.whenStable();
      await click('[data-testid=retry-order]');
      const retry = http.expectOne({
        method: 'POST',
        url: `${ordersDataConfig.apiBaseUrl}/orders`,
      });
      expect(retry.request.body).toEqual(request);
      expect(retry.request.headers.get('Idempotency-Key')).toBe(
        '28d0f7ed-7330-44c4-8b0e-83c29a43e3c2',
      );
      retry.flush(
        { data: { ...request, id: 91, openTime: 1750444222000, swap: 0 } },
        { status: 201, statusText: 'Created' },
      );
      await fixture.whenStable();
      expect(element.querySelector('app-order-form')).toBeNull();
    },
  );

  it('shows a recoverable HTTP error and successfully retries', async () => {
    const requests = http.match(() => true);
    requests[0].flush(null, { status: 503, statusText: 'Unavailable' });
    await fixture.whenStable();
    expect(element.textContent).toContain('Nie udało się załadować danych');
    await click('.state-panel button');
    await load();
    expect(element.querySelectorAll('.group-row')).toHaveLength(2);
  });

  it('cancels the form subscription when closing an unneeded symbol', async () => {
    await load();
    await click('[aria-label="Zamknij grupę BTCUSD"]');
    await openForm();
    await fill('#order-symbol', 'BTCUSD');
    expect(socket.sent.at(-1)).toEqual({ p: '/subscribe/addlist', d: ['BTCUSD'] });
    await click('[aria-label="Zamknij formularz"]');
    expect(socket.sent.at(-1)).toEqual({ p: '/subscribe/removelist', d: ['BTCUSD'] });
  });
});
