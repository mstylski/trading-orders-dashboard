import { QuoteSocket } from '../data/quote-socket';
import { Order, OrdersData, Quote } from '../models/order.models';

export const testOrders: readonly Order[] = [
  {
    id: 10,
    symbol: 'BTCUSD',
    side: 'BUY',
    size: 2,
    openPrice: 100,
    openTime: 1750444222000,
    swap: -0.2,
  },
  {
    id: 11,
    symbol: 'EURUSD',
    side: 'SELL',
    size: 1,
    openPrice: 1.2,
    openTime: 1750444222000,
    swap: 0.1,
  },
  {
    id: 20,
    symbol: 'BTCUSD',
    side: 'SELL',
    size: 1,
    openPrice: 120,
    openTime: 1750444222000,
    swap: -0.3,
  },
];

export const testData: OrdersData = {
  orders: testOrders,
  instruments: [
    { symbol: 'BTCUSD', contractType: 1 },
    { symbol: 'EURUSD', contractType: 5 },
  ],
  contracts: [
    { contractType: 1, contractSize: 10 },
    { contractType: 5, contractSize: 100000 },
  ],
};

export const testQuote = (symbol = 'BTCUSD', bid = 110, timestamp = 1000): Quote => ({
  symbol,
  bid,
  ask: bid + 10,
  timestamp,
});

export class FakeSocket implements QuoteSocket {
  readyState: QuoteSocket['readyState'] = 0;
  onopen: QuoteSocket['onopen'] = null;
  onclose: QuoteSocket['onclose'] = null;
  onerror: QuoteSocket['onerror'] = null;
  onmessage: QuoteSocket['onmessage'] = null;
  readonly sent: { p: string; d: string[] }[] = [];
  closeCount = 0;

  open(): void {
    this.readyState = 1;
    this.onopen?.call(this as unknown as WebSocket, new Event('open'));
  }

  message(data: unknown): void {
    this.onmessage?.call(
      this as unknown as WebSocket,
      new MessageEvent('message', { data: typeof data === 'string' ? data : JSON.stringify(data) }),
    );
  }

  quote(symbol = 'BTCUSD', bid = 110, timestamp = 1): void {
    this.message({
      p: '/quotes/subscribed',
      d: [{ s: symbol, b: bid, a: bid + 10, t: timestamp }],
    });
  }

  fail(): void {
    this.readyState = 3;
    this.onclose?.call(this as unknown as WebSocket, new CloseEvent('close'));
  }

  send(data: string): void {
    this.sent.push(JSON.parse(data) as { p: string; d: string[] });
  }
  close(): void {
    this.closeCount++;
    this.readyState = 3;
  }
}
