import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { PLATFORM_ID, RESPONSE_INIT } from '@angular/core';
import { ORDERS_API } from '../data/orders-api.service';
import { QuotesService } from '../data/quotes.service';
import { NewOrder, OrdersData } from '../models/order.models';
import { FakeSocket, testData } from '../testing/fixtures';
import { QUOTE_SOCKET_FACTORY } from '../data/quote-socket';
import { OrdersStore } from './orders.store';

describe('OrdersStore', () => {
  let store: OrdersStore;
  let http: HttpTestingController;
  let sockets: FakeSocket[];
  const input: NewOrder = { symbol: 'BTCUSD', side: 'BUY', size: 0.05, openTime: 1750444222000 };

  beforeEach(() => {
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
        { provide: QUOTE_SOCKET_FACTORY, useValue: createSocket },
      ],
    });
    store = TestBed.inject(OrdersStore);
    http = TestBed.inject(HttpTestingController);
  });
  afterEach(() => {
    http.verify();
  });

  function load(data: OrdersData = testData): FakeSocket {
    store.load();
    http.expectOne(`${ORDERS_API}/order-data.json`).flush({ data: data.orders });
    http.expectOne(`${ORDERS_API}/instruments.json`).flush(data.instruments);
    http.expectOne(`${ORDERS_API}/contract-types.json`).flush(data.contracts);
    TestBed.tick();
    sockets[0].open();
    return sockets[0];
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
    expect(store.addOrder(input)).toHaveProperty('error');
    socket.quote('BTCUSD', 115);
    expect(store.unavailablePriceReason()).toBeNull();
    const result = store.addOrder(input);
    expect(result).toHaveProperty('order');
    expect(store.groups()[0]).toMatchObject({
      symbol: 'BTCUSD',
      count: 1,
      openPrice: 115,
      profit: 0,
    });
  });

  it('takes the latest bid at submit, fixes the open price and never reuses deleted IDs', () => {
    const socket = load();
    socket.quote('BTCUSD', 111);
    store.selectFormSymbol('BTCUSD');
    expect(store.selectedPrice()).toBe(111);
    socket.quote('BTCUSD', 112);
    expect(store.addOrder(input)).toMatchObject({ order: { id: 21, openPrice: 112, swap: 0 } });
    socket.quote('BTCUSD', 114);
    expect(store.orders().at(-1)?.openPrice).toBe(112);
    expect(store.groups()[0].orders.at(-1)?.profit).toBe(1);
    store.closeOrder(21);
    expect(store.addOrder(input)).toMatchObject({ order: { id: 22 } });
  });

  it('does not generate an unsafe ID after the largest valid API ID', () => {
    const socket = load({
      ...testData,
      orders: [{ ...testData.orders[0], id: Number.MAX_SAFE_INTEGER }],
    });
    socket.quote();
    expect(store.addOrder(input)).toEqual({ error: 'id-exhausted' });
    expect(store.orders()).toHaveLength(1);
  });

  it('rejects invalid input and missing contract mappings', () => {
    const socket = load();
    socket.quote();
    for (const invalid of [
      { ...input, size: 0 },
      { ...input, size: Infinity },
      { ...input, symbol: 'UNKNOWN' },
      { ...input, openTime: NaN },
    ]) {
      expect(store.addOrder(invalid)).toHaveProperty('error');
    }
    expect(store.orders()).toHaveLength(3);
  });

  it('shows unavailable profit and prevents adding with missing contract data', () => {
    const socket = load({ ...testData, contracts: [] });
    socket.quote();
    store.selectFormSymbol('BTCUSD');
    expect(store.groups()[0].profit).toBeNull();
    expect(store.unavailablePriceReason()).toBe('missing-contract');
    expect(store.addOrder(input)).toHaveProperty('error');
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
      expect(store.addOrder(input)).toHaveProperty('error');
      vi.advanceTimersByTime(1000);
      sockets[1].open();
      expect(store.addOrder(input)).toHaveProperty('error');
      sockets[1].quote();
      expect(store.addOrder(input)).toHaveProperty('order');
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
  it('sets an error HTTP status for failed upstream data and keeps retry available', () => {
    const responseInit: ResponseInit = {};
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        OrdersStore,
        QuotesService,
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
    serverHttp.expectOne(`${ORDERS_API}/order-data.json`).flush({ data: testData.orders });
    serverHttp.expectOne(`${ORDERS_API}/instruments.json`).flush(testData.instruments);
    serverHttp.expectOne(`${ORDERS_API}/contract-types.json`).flush(testData.contracts);
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
          { provide: PLATFORM_ID, useValue: 'server' },
          { provide: QUOTE_SOCKET_FACTORY, useValue: createSocket },
        ],
      });
      const serverStore = TestBed.inject(OrdersStore);
      const serverHttp = TestBed.inject(HttpTestingController);
      serverStore.load();
      serverHttp.expectOne(`${ORDERS_API}/order-data.json`).flush({ data: testData.orders });
      serverHttp.expectOne(`${ORDERS_API}/instruments.json`).flush(testData.instruments);
      serverHttp.expectOne(`${ORDERS_API}/contract-types.json`).flush(testData.contracts);
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
