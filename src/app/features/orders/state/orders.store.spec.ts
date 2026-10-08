import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { ORDERS_API } from '../data/orders-api.service';
import { QuotesService } from '../data/quotes.service';
import { NewOrder, OrdersData } from '../models/order.models';
import { FakeSocket, testData } from '../testing/fixtures';
import { OrdersStore } from './orders.store';

describe('OrdersStore', () => {
  let store: OrdersStore;
  let http: HttpTestingController;
  let sockets: FakeSocket[];
  const input: NewOrder = { symbol: 'BTCUSD', side: 'BUY', size: 0.05, openTime: 1750444222000 };

  beforeEach(() => {
    sockets = [];
    vi.stubGlobal('WebSocket', function () {
      const socket = new FakeSocket();
      sockets.push(socket);
      return socket;
    });
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        OrdersStore,
        QuotesService,
      ],
    });
    store = TestBed.inject(OrdersStore);
    http = TestBed.inject(HttpTestingController);
  });
  afterEach(() => {
    http.verify();
    vi.unstubAllGlobals();
  });

  function load(data: OrdersData = testData): FakeSocket {
    store.load();
    http.expectOne(`${ORDERS_API}/order-data.json`).flush({ data: data.orders });
    http.expectOne(`${ORDERS_API}/instruments.json`).flush(data.instruments);
    http.expectOne(`${ORDERS_API}/contract-types.json`).flush(data.contracts);
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
    expect(store.groups().find((group) => group.symbol === 'BTCUSD')).toMatchObject({
      count: 1,
      size: 1,
      openPrice: 120,
      profit: 100,
    });
    expect(socket.sent).toHaveLength(1);
    expect(store.closeGroup('BTCUSD')).toEqual([20]);
    expect(socket.sent.at(-1)).toEqual({ p: '/subscribe/removelist', d: ['BTCUSD'] });
    expect(store.closeOrder(999)).toEqual([]);
    expect(store.symbols()).toEqual(['BTCUSD', 'EURUSD']);
  });

  it('keeps the selected form symbol subscribed after closing a group', () => {
    const socket = load();
    store.selectFormSymbol('BTCUSD');
    expect(store.closeGroup('BTCUSD')).toEqual([10, 20]);
    expect(socket.sent).toHaveLength(1);
    store.selectFormSymbol(null);
    expect(socket.sent.at(-1)).toEqual({ p: '/subscribe/removelist', d: ['BTCUSD'] });
  });

  it('reopens a deleted group only after a fresh resubscription quote', () => {
    const socket = load();
    socket.quote();
    store.closeGroup('BTCUSD');
    store.closeGroup('EURUSD');
    expect(store.groups()).toEqual([]);
    store.selectFormSymbol('BTCUSD');
    expect(socket.sent.at(-1)).toEqual({ p: '/subscribe/addlist', d: ['BTCUSD'] });
    expect(store.unavailablePriceReason()).toContain('świeże');
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
    expect(store.unavailablePriceReason()).toContain('kontraktu');
    expect(store.addOrder(input)).toHaveProperty('error');
  });

  it('keeps profit visible but blocks adding during disconnection and before new prices', () => {
    vi.useFakeTimers();
    try {
      const socket = load();
      socket.quote();
      store.selectFormSymbol('BTCUSD');
      socket.fail();
      expect(store.hasStaleQuotes()).toBe(true);
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

  it('cancels unfinished HTTP requests when the page scope is destroyed', () => {
    store.load();
    const requests = http.match(() => true);
    TestBed.resetTestingModule();
    expect(requests.every((request) => request.cancelled)).toBe(true);
    expect(sockets).toHaveLength(0);
  });
});
