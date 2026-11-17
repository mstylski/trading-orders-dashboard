import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { PLATFORM_ID, RESPONSE_INIT } from '@angular/core';
import { ApiErrorCode } from '../../../../../api/contracts/api-error-code';
import { ORDERS_DATA_CONFIG, ordersDataConfig } from '../data/orders-data.config';
import { QuotesService } from '../data/quotes.service';
import { AddOrderResult, NewOrder, OrdersData } from '../models/order.models';
import { FakeSocket, testData } from '../testing/fixtures';
import { QUOTE_SOCKET_FACTORY } from '../data/quote-socket';
import { OrdersStore, PENDING_ORDER_STORAGE_KEY } from './orders.store';

describe('OrdersStore', () => {
  let store: OrdersStore;
  let http: HttpTestingController;
  let sockets: FakeSocket[];
  const input: NewOrder = {
    symbol: 'BTCUSD',
    side: 'BUY',
    size: 0.05,
  };

  beforeEach(() => {
    sessionStorage.removeItem(PENDING_ORDER_STORAGE_KEY);
    sockets = [];
    const createSocket = () => {
      const socket = new FakeSocket();
      sockets.push(socket);
      return socket;
    };
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        OrdersStore,
        QuotesService,
        { provide: ORDERS_DATA_CONFIG, useValue: ordersDataConfig },
        { provide: QUOTE_SOCKET_FACTORY, useValue: createSocket },
      ],
    });
    store = TestBed.inject(OrdersStore);
    http = TestBed.inject(HttpTestingController);
  });
  afterEach(() => {
    http.verify();
    sessionStorage.removeItem(PENDING_ORDER_STORAGE_KEY);
  });

  function load(data: OrdersData = testData): FakeSocket {
    store.load();
    http.expectOne(`${ordersDataConfig.apiBaseUrl}/orders`).flush({ data: data.orders });
    http.expectOne(`${ordersDataConfig.apiBaseUrl}/instruments`).flush(data.instruments);
    http.expectOne(`${ordersDataConfig.apiBaseUrl}/contract-types`).flush(data.contracts);
    TestBed.tick();
    sockets[0].open();
    return sockets[0];
  }

  function add(order: NewOrder = input): AddOrderResult[] {
    const results: AddOrderResult[] = [];
    store.addOrder(order).subscribe((result) => results.push(result));
    return results;
  }

  function confirm(id = 21, openPrice = 110): void {
    http
      .expectOne({ method: 'POST', url: `${ordersDataConfig.apiBaseUrl}/orders` })
      .flush(
        { data: { ...input, id, openPrice, openTime: 1750444222000, swap: 0 } },
        { status: 201, statusText: 'Created' },
      );
  }

  it('loads only once, derives groups and preserves initial symbol ordering', () => {
    const socket = load();
    store.load();
    socket.quote();
    expect(store.status()).toBe('ready');
    expect(store.symbols()).toEqual(['BTCUSD', 'EURUSD']);
    expect(store.groups()[0]).toMatchObject({ count: 2, profit: 300 });
    expect(store.groups()[1].profit).toBeNull();
    expect(sockets).toHaveLength(1);
  });

  it('retries a failed load and supports an initially empty source', () => {
    store.load();
    const requests = http.match(() => true);
    requests[0].flush(null, { status: 500, statusText: 'Failure' });
    expect(store.status()).toBe('error');
    expect(store.error()).toContain('Nie udało');
    load({ orders: [], instruments: [], contracts: [] });
    expect(store.status()).toBe('ready');
    expect(store.groups()).toEqual([]);
    expect(store.symbols()).toEqual([]);
  });

  it('allows the first order for an instrument without existing positions', () => {
    const socket = load({ ...testData, orders: [] });
    expect(store.symbols()).toEqual(['BTCUSD', 'EURUSD']);
    store.selectFormSymbol('BTCUSD');
    TestBed.tick();
    socket.quote();
    const results = add();
    expect(store.orders()).toEqual([]);
    confirm();
    expect(results[0]).toHaveProperty('order');
    expect(store.orders()).toHaveLength(1);
  });

  it('closes individual orders and groups, recalculates totals and returns IDs in source order', () => {
    const socket = load();
    socket.quote();
    expect(store.closeOrder(10)).toEqual([10]);
    TestBed.tick();
    expect(store.groups().find((group) => group.symbol === 'BTCUSD')).toMatchObject({
      count: 1,
      size: 1,
      openPrice: 120,
      profit: 100,
    });
    expect(socket.sent).toHaveLength(1);
    expect(store.closeGroup('BTCUSD')).toEqual([20]);
    TestBed.tick();
    expect(socket.sent.at(-1)).toEqual({ p: '/subscribe/removelist', d: ['BTCUSD'] });
    expect(store.closeOrder(999)).toEqual([]);
    expect(store.symbols()).toEqual(['BTCUSD', 'EURUSD']);
  });

  it('keeps the selected form symbol subscribed after closing a group', () => {
    const socket = load();
    store.selectFormSymbol('BTCUSD');
    expect(store.closeGroup('BTCUSD')).toEqual([10, 20]);
    TestBed.tick();
    expect(socket.sent).toHaveLength(1);
    store.selectFormSymbol(null);
    TestBed.tick();
    expect(socket.sent.at(-1)).toEqual({ p: '/subscribe/removelist', d: ['BTCUSD'] });
  });

  it('reopens a deleted group only after a fresh resubscription quote', () => {
    const socket = load();
    socket.quote();
    store.closeGroup('BTCUSD');
    store.closeGroup('EURUSD');
    TestBed.tick();
    expect(store.groups()).toEqual([]);
    store.selectFormSymbol('BTCUSD');
    TestBed.tick();
    expect(socket.sent.at(-1)).toEqual({ p: '/subscribe/addlist', d: ['BTCUSD'] });
    expect(store.unavailablePriceReason()).toBe('awaiting-quote');
    expect(add()[0]).toHaveProperty('error');
    socket.quote('BTCUSD', 115);
    expect(store.unavailablePriceReason()).toBeNull();
    const results = add();
    expect(results).toEqual([]);
    confirm(21, 115);
    expect(results[0]).toHaveProperty('order');
    expect(store.groups()[0]).toMatchObject({
      symbol: 'BTCUSD',
      count: 1,
      openPrice: 115,
      profit: 0,
    });
  });

  it('takes the latest bid and waits for the server ID and opening time', () => {
    const socket = load();
    socket.quote('BTCUSD', 111);
    store.selectFormSymbol('BTCUSD');
    expect(store.selectedPrice()).toBe(111);
    socket.quote('BTCUSD', 112);
    const results = add();
    expect(store.orders()).toHaveLength(3);
    expect(store.saving()).toBe(true);
    const request = http.expectOne({
      method: 'POST',
      url: `${ordersDataConfig.apiBaseUrl}/orders`,
    });
    expect(request.request.body).toEqual({ ...input, openPrice: 112 });
    expect(add()).toEqual([{ error: 'saving' }]);
    request.flush(
      { data: { ...input, id: 91, openPrice: 112, openTime: 1750444222000, swap: 0 } },
      { status: 201, statusText: 'Created' },
    );
    expect(results).toMatchObject([
      { order: { id: 91, openPrice: 112, openTime: 1750444222000, swap: 0 } },
    ]);
    expect(store.saving()).toBe(false);
    socket.quote('BTCUSD', 114);
    expect(store.orders().at(-1)?.openPrice).toBe(112);
    expect(store.groups()[0].orders.at(-1)?.profit).toBe(1);
    store.closeOrder(91);
    const next = add();
    confirm(120, 114);
    expect(next).toMatchObject([{ order: { id: 120 } }]);
  });

  it('does not append an unsafe API ID after the largest valid existing ID', () => {
    const initialOrder = { ...testData.orders[0], id: Number.MAX_SAFE_INTEGER };
    const socket = load({ ...testData, orders: [initialOrder] });
    socket.quote();
    const results = add();
    confirm(Number.MAX_SAFE_INTEGER + 1);
    expect(results).toEqual([{ error: 'save-failed' }]);
    expect(store.orders()).toEqual([initialOrder]);
    expect(store.saving()).toBe(false);
  });

  it.each(['network', 'timeout', 'server', 'malformed'] as const)(
    'reuses the stored key and original payload after an uncertain %s result',
    (failure) => {
      const socket = load();
      socket.quote('BTCUSD', 111);
      add();
      const first = http.expectOne({
        method: 'POST',
        url: `${ordersDataConfig.apiBaseUrl}/orders`,
      });
      const key = first.request.headers.get('Idempotency-Key');
      const body = first.request.body;
      expect(key).toMatch(/^[0-9a-f-]{36}$/);
      expect(JSON.parse(sessionStorage.getItem(PENDING_ORDER_STORAGE_KEY)!)).toEqual({
        key,
        request: body,
      });
      if (failure === 'network' || failure === 'timeout')
        first.error(new ProgressEvent(failure === 'timeout' ? 'timeout' : 'error'));
      else if (failure === 'server') first.flush({}, { status: 500, statusText: 'Failure' });
      else first.flush({}, { status: 201, statusText: 'Created' });
      socket.quote('BTCUSD', 222);
      socket.fail();
      add();
      const retry = http.expectOne({
        method: 'POST',
        url: `${ordersDataConfig.apiBaseUrl}/orders`,
      });
      expect(retry.request.headers.get('Idempotency-Key')).toBe(key);
      expect(retry.request.body).toEqual(body);
      retry.flush(
        { data: { ...body, id: 91, openTime: 1750444222000, swap: 0 } },
        { status: 201, statusText: 'Created' },
      );
      expect(sessionStorage.getItem(PENDING_ORDER_STORAGE_KEY)).toBeNull();
    },
  );

  it('restores a browser attempt after a reload and deduplicates its already loaded order', () => {
    const pending = {
      key: '28d0f7ed-7330-44c4-8b0e-83c29a43e3c2',
      request: { ...input, openPrice: 111 },
    };
    const committed = { ...pending.request, id: 91, openTime: 1750444222000, swap: 0 };
    sessionStorage.setItem(PENDING_ORDER_STORAGE_KEY, JSON.stringify(pending));
    expect(store.restorePendingOrder()).toEqual(pending.request);
    load({ ...testData, orders: [...testData.orders, committed] });
    add();
    const retry = http.expectOne({ method: 'POST', url: `${ordersDataConfig.apiBaseUrl}/orders` });
    expect(retry.request.headers.get('Idempotency-Key')).toBe(pending.key);
    expect(retry.request.body).toEqual(pending.request);
    retry.flush({ data: committed }, { status: 201, statusText: 'Created' });
    expect(store.orders()).toEqual([...testData.orders, committed]);
    expect(store.pendingOrder()).toBeNull();
    expect(sessionStorage.getItem(PENDING_ORDER_STORAGE_KEY)).toBeNull();
  });

  it('preserves an uncertain snapshot when edited input tries to replace it', () => {
    const socket = load();
    socket.quote('BTCUSD', 111);
    add();
    const first = http.expectOne({ method: 'POST', url: `${ordersDataConfig.apiBaseUrl}/orders` });
    const key = first.request.headers.get('Idempotency-Key');
    const body = first.request.body;
    first.error(new ProgressEvent('error'));
    const stored = sessionStorage.getItem(PENDING_ORDER_STORAGE_KEY);

    for (const changed of [
      { ...input, size: 0.125 },
      { ...input, symbol: 'EURUSD' },
      { ...input, side: 'SELL' as const },
    ]) {
      expect(add(changed)).toEqual([{ error: 'invalid-input' }]);
      http.expectNone({ method: 'POST', url: `${ordersDataConfig.apiBaseUrl}/orders` });
      expect(sessionStorage.getItem(PENDING_ORDER_STORAGE_KEY)).toBe(stored);
      expect(store.pendingOrder()).toEqual(body);
    }
    socket.quote('BTCUSD', 222);
    socket.fail();
    add();
    const retry = http.expectOne({ method: 'POST', url: `${ordersDataConfig.apiBaseUrl}/orders` });
    expect(retry.request.headers.get('Idempotency-Key')).toBe(key);
    expect(retry.request.body).toEqual(body);
    retry.flush(
      { data: { ...body, id: 91, openTime: 1750444222000, swap: 0 } },
      { status: 201, statusText: 'Created' },
    );
    expect(store.pendingOrder()).toBeNull();
  });

  it('uses a new key for a new operation with identical input after success', () => {
    const socket = load();
    socket.quote('BTCUSD', 111);
    add();
    const first = http.expectOne({ method: 'POST', url: `${ordersDataConfig.apiBaseUrl}/orders` });
    const firstKey = first.request.headers.get('Idempotency-Key');
    first.flush(
      { data: { ...first.request.body, id: 91, openTime: 1750444222000, swap: 0 } },
      { status: 201, statusText: 'Created' },
    );
    add();
    const next = http.expectOne({ method: 'POST', url: `${ordersDataConfig.apiBaseUrl}/orders` });
    expect(next.request.headers.get('Idempotency-Key')).not.toBe(firstKey);
    next.flush(
      { data: { ...next.request.body, id: 92, openTime: 1750444223000, swap: 0 } },
      { status: 201, statusText: 'Created' },
    );
    expect(
      store
        .orders()
        .slice(-2)
        .map((order) => order.id),
    ).toEqual([91, 92]);
  });
  it('reports idempotency conflicts explicitly and discards the rejected attempt', () => {
    const socket = load();
    socket.quote();
    const results = add();
    http
      .expectOne({ method: 'POST', url: `${ordersDataConfig.apiBaseUrl}/orders` })
      .flush({ code: ApiErrorCode.IdempotencyKeyReused }, { status: 409, statusText: 'Conflict' });
    expect(results).toEqual([{ error: 'idempotency-conflict' }]);
    expect(store.pendingOrder()).toBeNull();
    expect(sessionStorage.getItem(PENDING_ORDER_STORAGE_KEY)).toBeNull();
  });

  const legacyKey = '28d0f7ed-7330-44c4-8b0e-83c29a43e3c2';
  const legacyRequest = { ...input, openPrice: 111, openTime: 1750444222000 };

  function restoreLegacy(): string {
    const stored = JSON.stringify({ key: legacyKey, request: legacyRequest });
    sessionStorage.setItem(PENDING_ORDER_STORAGE_KEY, stored);
    expect(store.restorePendingOrder()).toBeNull();
    expect(store.legacyPending()).toEqual({ key: legacyKey, request: legacyRequest });
    return stored;
  }

  it('preserves a valid five-field pending across restoration and blocks replacing it', () => {
    load();
    const stored = restoreLegacy();
    expect(add()).toEqual([{ error: 'legacy-pending' }]);
    store.restorePendingOrder();
    expect(sessionStorage.getItem(PENDING_ORDER_STORAGE_KEY)).toBe(stored);
    http.expectNone((request) => request.method === 'POST');
  });

  it('confirms the original legacy result without adding a duplicate or submitting POST', () => {
    const order = { ...legacyRequest, id: 91, swap: 0 };
    load({ ...testData, orders: [...testData.orders, order] });
    restoreLegacy();
    const results: AddOrderResult[] = [];
    store.resolveLegacyOrder().subscribe((result) => results.push(result));
    http
      .expectOne({
        method: 'GET',
        url: `${ordersDataConfig.apiBaseUrl}/orders/operations/${legacyKey}`,
      })
      .flush({ data: order }, { status: 201, statusText: 'Created' });
    expect(results).toEqual([{ order }]);
    expect(store.orders().filter((row) => row.id === 91)).toEqual([order]);
    expect(store.legacyPending()).toBeNull();
    expect(sessionStorage.getItem(PENDING_ORDER_STORAGE_KEY)).toBeNull();
    http.expectNone((request) => request.method === 'POST');
  });

  it.each([0, 404, 500])(
    'retains the full legacy snapshot when result lookup fails with %s',
    (status) => {
      load();
      const stored = restoreLegacy();
      const results: AddOrderResult[] = [];
      store.resolveLegacyOrder().subscribe((result) => results.push(result));
      const request = http.expectOne(
        `${ordersDataConfig.apiBaseUrl}/orders/operations/${legacyKey}`,
      );
      if (status === 0) request.error(new ProgressEvent('error'));
      else request.flush({}, { status, statusText: 'Failure' });
      expect(results).toEqual([{ error: status === 404 ? 'operation-not-found' : 'save-failed' }]);
      expect(sessionStorage.getItem(PENDING_ORDER_STORAGE_KEY)).toBe(stored);
      expect(store.legacyPending()?.key).toBe(legacyKey);
      expect(add()).toEqual([{ error: 'legacy-pending' }]);
    },
  );

  it('does not confirm a result that differs from the preserved legacy payload', () => {
    load();
    const stored = restoreLegacy();
    const results: AddOrderResult[] = [];
    store.resolveLegacyOrder().subscribe((result) => results.push(result));
    http
      .expectOne(`${ordersDataConfig.apiBaseUrl}/orders/operations/${legacyKey}`)
      .flush(
        { data: { ...legacyRequest, id: 91, swap: 0, openTime: legacyRequest.openTime + 1 } },
        { status: 201, statusText: 'Created' },
      );
    expect(results).toEqual([{ error: 'save-failed' }]);
    expect(sessionStorage.getItem(PENDING_ORDER_STORAGE_KEY)).toBe(stored);
    expect(store.orders()).toHaveLength(3);
  });

  it.each([0, NaN, '2025-01-01', 253402300800000])(
    'discards a malformed legacy snapshot with time %s',
    (openTime) => {
      // Zero is valid in the old contract, so make its volume invalid instead.
      sessionStorage.setItem(
        PENDING_ORDER_STORAGE_KEY,
        JSON.stringify({
          key: legacyKey,
          request: { ...legacyRequest, openTime, ...(openTime === 0 ? { size: 0 } : {}) },
        }),
      );
      store.restorePendingOrder();
      expect(store.legacyPending()).toBeNull();
      expect(sessionStorage.getItem(PENDING_ORDER_STORAGE_KEY)).toBeNull();
    },
  );

  it('ignores invalid persisted attempts', () => {
    sessionStorage.setItem(
      PENDING_ORDER_STORAGE_KEY,
      JSON.stringify({ key: 'invalid', request: input }),
    );
    expect(store.restorePendingOrder()).toBeNull();
    expect(sessionStorage.getItem(PENDING_ORDER_STORAGE_KEY)).toBeNull();
  });

  it.each([400, 404, 500])(
    'does not append a local order after HTTP %s and permits retry',
    (status) => {
      const socket = load();
      socket.quote();
      const results = add();
      http
        .expectOne({ method: 'POST', url: `${ordersDataConfig.apiBaseUrl}/orders` })
        .flush({ message: 'Failure' }, { status, statusText: 'Failure' });
      expect(results).toEqual([
        {
          error:
            status === 400 ? 'invalid-input' : status === 404 ? 'unknown-symbol' : 'save-failed',
        },
      ]);
      expect(store.orders()).toHaveLength(3);
      expect(store.saving()).toBe(false);
      const retry = add();
      confirm();
      expect(retry[0]).toHaveProperty('order');
    },
  );

  it('rejects invalid input and missing contract mappings', () => {
    const socket = load();
    socket.quote();
    for (const invalid of [
      { ...input, size: 0 },
      { ...input, size: Infinity },
      { ...input, symbol: 'UNKNOWN' },
    ]) {
      expect(add(invalid)[0]).toHaveProperty('error');
    }
    expect(store.orders()).toHaveLength(3);
  });

  it('shows unavailable profit and prevents adding with missing contract data', () => {
    const socket = load({ ...testData, contracts: [] });
    socket.quote();
    store.selectFormSymbol('BTCUSD');
    expect(store.groups()[0].profit).toBeNull();
    expect(store.unavailablePriceReason()).toBe('missing-contract');
    expect(add()[0]).toHaveProperty('error');
  });

  it('keeps profit visible but blocks adding during disconnection and before new prices', () => {
    vi.useFakeTimers();
    try {
      const socket = load();
      socket.quote();
      store.selectFormSymbol('BTCUSD');
      socket.fail();
      expect(store.quoteFreshness().get('BTCUSD')).toBe('stale');
      expect(store.groups()[0].profit).toBe(300);
      expect(add()[0]).toHaveProperty('error');
      vi.advanceTimersByTime(1000);
      sockets[1].open();
      expect(add()[0]).toHaveProperty('error');
      sockets[1].quote();
      const results = add();
      confirm();
      expect(results[0]).toHaveProperty('order');
    } finally {
      TestBed.resetTestingModule();
      vi.useRealTimers();
    }
  });

  it('marks each symbol current only after its own quote returns following reconnect', () => {
    vi.useFakeTimers();
    try {
      const socket = load();
      socket.quote('BTCUSD');
      socket.quote('EURUSD', 1.1);
      expect([...store.quoteFreshness().values()]).toEqual(['current', 'current']);
      socket.fail();
      expect([...store.quoteFreshness().values()]).toEqual(['stale', 'stale']);
      vi.advanceTimersByTime(1000);
      sockets[1].open();
      sockets[1].quote('BTCUSD', 112);
      expect(store.quoteFreshness().get('BTCUSD')).toBe('current');
      expect(store.quoteFreshness().get('EURUSD')).toBe('stale');
      sockets[1].quote('EURUSD', 1.2);
      expect([...store.quoteFreshness().values()]).toEqual(['current', 'current']);
    } finally {
      TestBed.resetTestingModule();
      vi.useRealTimers();
    }
  });

  it('syncs changed symbols without rerunning the effect on connection status changes', () => {
    vi.useFakeTimers();
    try {
      const quoteService = TestBed.inject(QuotesService);
      const setSymbols = vi.spyOn(quoteService, 'setSymbols');
      const socket = load();
      expect(setSymbols).toHaveBeenCalledTimes(1);

      socket.fail();
      vi.advanceTimersByTime(1000);
      sockets[1].open();
      TestBed.tick();
      expect(setSymbols).toHaveBeenCalledTimes(1);
      expect(sockets[1].sent).toEqual([{ p: '/subscribe/addlist', d: ['BTCUSD', 'EURUSD'] }]);

      store.closeGroup('BTCUSD');
      TestBed.tick();
      expect(setSymbols).toHaveBeenCalledTimes(2);
      expect(sockets[1].sent.at(-1)).toEqual({ p: '/subscribe/removelist', d: ['BTCUSD'] });
    } finally {
      TestBed.resetTestingModule();
      vi.useRealTimers();
    }
  });

  it('cancels unfinished HTTP requests when the page scope is destroyed', () => {
    store.load();
    const requests = http.match(() => true);
    TestBed.resetTestingModule();
    expect(requests.every((request) => request.cancelled)).toBe(true);
    expect(sockets).toHaveLength(0);
  });
});

describe('OrdersStore on the server', () => {
  it('never reads or writes browser storage while restoring an attempt', () => {
    const read = vi.spyOn(Storage.prototype, 'getItem');
    const write = vi.spyOn(Storage.prototype, 'setItem');
    const remove = vi.spyOn(Storage.prototype, 'removeItem');
    try {
      TestBed.configureTestingModule({
        providers: [
          provideHttpClient(),
          provideHttpClientTesting(),
          OrdersStore,
          QuotesService,
          { provide: ORDERS_DATA_CONFIG, useValue: ordersDataConfig },
          { provide: PLATFORM_ID, useValue: 'server' },
        ],
      });
      const serverStore = TestBed.inject(OrdersStore);
      expect(serverStore.restorePendingOrder()).toBeNull();
      expect(read).not.toHaveBeenCalled();
      expect(write).not.toHaveBeenCalled();
      expect(remove).not.toHaveBeenCalled();
    } finally {
      read.mockRestore();
      write.mockRestore();
      remove.mockRestore();
    }
  });

  it('sets an error HTTP status for failed upstream data and keeps retry available', () => {
    const responseInit: ResponseInit = {};
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        OrdersStore,
        QuotesService,
        { provide: ORDERS_DATA_CONFIG, useValue: ordersDataConfig },
        { provide: PLATFORM_ID, useValue: 'server' },
        { provide: RESPONSE_INIT, useValue: responseInit },
      ],
    });
    const serverStore = TestBed.inject(OrdersStore);
    const serverHttp = TestBed.inject(HttpTestingController);
    serverStore.load();
    const requests = serverHttp.match(() => true);
    requests[0].flush('Unavailable', { status: 503, statusText: 'Unavailable' });
    expect(responseInit.status).toBe(503);
    expect(serverStore.status()).toBe('error');
    serverStore.load();
    serverHttp.expectOne(`${ordersDataConfig.apiBaseUrl}/orders`).flush({ data: testData.orders });
    serverHttp.expectOne(`${ordersDataConfig.apiBaseUrl}/instruments`).flush(testData.instruments);
    serverHttp.expectOne(`${ordersDataConfig.apiBaseUrl}/contract-types`).flush(testData.contracts);
    expect(serverStore.status()).toBe('ready');
    serverHttp.verify();
  });

  it('loads REST data without creating a socket or reconnect timer', () => {
    vi.useFakeTimers();
    const createSocket = vi.fn(() => new FakeSocket());
    try {
      TestBed.configureTestingModule({
        providers: [
          provideHttpClient(),
          provideHttpClientTesting(),
          OrdersStore,
          QuotesService,
          { provide: ORDERS_DATA_CONFIG, useValue: ordersDataConfig },
          { provide: PLATFORM_ID, useValue: 'server' },
          { provide: QUOTE_SOCKET_FACTORY, useValue: createSocket },
        ],
      });
      const serverStore = TestBed.inject(OrdersStore);
      const serverHttp = TestBed.inject(HttpTestingController);
      serverStore.load();
      serverHttp
        .expectOne(`${ordersDataConfig.apiBaseUrl}/orders`)
        .flush({ data: testData.orders });
      serverHttp
        .expectOne(`${ordersDataConfig.apiBaseUrl}/instruments`)
        .flush(testData.instruments);
      serverHttp
        .expectOne(`${ordersDataConfig.apiBaseUrl}/contract-types`)
        .flush(testData.contracts);
      TestBed.tick();
      expect(serverStore.status()).toBe('ready');
      expect(serverStore.groups()).toHaveLength(2);
      expect(createSocket).not.toHaveBeenCalled();
      expect(vi.getTimerCount()).toBe(0);
      serverHttp.verify();
    } finally {
      TestBed.resetTestingModule();
      vi.useRealTimers();
    }
  });
});
