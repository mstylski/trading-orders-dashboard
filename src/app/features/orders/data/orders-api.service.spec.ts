import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { ORDERS_API, OrdersApiService } from './orders-api.service';
import { testData } from '../testing/fixtures';
import { OrdersData } from '../models/order.models';

describe('OrdersApiService', () => {
  let api: OrdersApiService;
  let http: HttpTestingController;
  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    api = TestBed.inject(OrdersApiService);
    http = TestBed.inject(HttpTestingController);
  });
  afterEach(() => http.verify());

  function flush(
    orders: unknown = { data: testData.orders },
    instruments: unknown = testData.instruments,
    contracts: unknown = testData.contracts,
  ): void {
    http.expectOne(`${ORDERS_API}/order-data.json`).flush(orders as object);
    http.expectOne(`${ORDERS_API}/instruments.json`).flush(instruments as object);
    http.expectOne(`${ORDERS_API}/contract-types.json`).flush(contracts as object);
  }

  it('starts all three requests and unwraps the order data', () => {
    let result: OrdersData | undefined;
    api.load().subscribe((value) => (result = value));
    expect(http.match(() => false)).toEqual([]);
    flush();
    expect(result).toEqual(testData);
  });

  it('accepts empty data and missing mappings for a recoverable dash in the UI', () => {
    const results: OrdersData[] = [];
    api.load().subscribe((value) => results.push(value));
    flush({ data: [] }, [], []);
    api.load().subscribe((value) => results.push(value));
    flush({ data: testData.orders }, [], []);
    expect(results[0].orders).toEqual([]);
    expect(results[1].orders).toHaveLength(3);
  });

  it.each([
    [],
    { data: [{ ...testData.orders[0], side: 'INVALID' }] },
    { data: [{ ...testData.orders[0], size: -1 }] },
    { data: [testData.orders[0], testData.orders[0]] },
  ])('rejects malformed order data: %j', (orders) => {
    const error = vi.fn();
    api.load().subscribe({ error });
    flush(orders);
    expect(error).toHaveBeenCalledWith(expect.objectContaining({ resource: 'orders' }));
  });

  it('rejects invalid contract sizes', () => {
    const error = vi.fn();
    api.load().subscribe({ error });
    flush(undefined, undefined, [{ contractType: 1, contractSize: 0 }]);
    expect(error).toHaveBeenCalledOnce();
  });

  it('propagates an HTTP error and allows retrying the complete request', () => {
    const error = vi.fn();
    api.load().subscribe({ error });
    const requests = http.match(() => true);
    requests[0].flush('Unavailable', { status: 503, statusText: 'Unavailable' });
    expect(error).toHaveBeenCalledOnce();
    expect(requests[1].cancelled).toBe(true);
    expect(requests[2].cancelled).toBe(true);
    const next = vi.fn();
    api.load().subscribe(next);
    flush();
    expect(next).toHaveBeenCalledWith(testData);
  });

  it('ends a stalled load within five seconds and cancels all pending requests', () => {
    vi.useFakeTimers();
    try {
      const error = vi.fn();
      api.load().subscribe({ error });
      const requests = http.match(() => true);
      requests[0].flush({ data: testData.orders });
      vi.advanceTimersByTime(5_000);
      expect(error).toHaveBeenCalledOnce();
      expect(requests[1].cancelled).toBe(true);
      expect(requests[2].cancelled).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });
});
