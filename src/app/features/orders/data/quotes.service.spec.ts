import { TestBed } from '@angular/core/testing';
import { QuotesService } from './quotes.service';
import { FakeSocket } from '../testing/fixtures';
import { QUOTE_SOCKET_FACTORY } from './quote-socket';

describe('QuotesService', () => {
  let quotes: QuotesService;
  let sockets: FakeSocket[];
  beforeEach(() => {
    vi.useFakeTimers();
    sockets = [];
    const createSocket = () => {
      const socket = new FakeSocket();
      sockets.push(socket);
      return socket;
    };
    TestBed.configureTestingModule({
      providers: [QuotesService, { provide: QUOTE_SOCKET_FACTORY, useValue: createSocket }],
    });
    quotes = TestBed.inject(QuotesService);
  });
  afterEach(() => {
    TestBed.resetTestingModule();
    vi.useRealTimers();
  });

  it('uses one socket and sends only subscription differences', () => {
    quotes.setSymbols(['BTCUSD', 'BTCUSD', 'EURUSD']);
    sockets[0].open();
    quotes.setSymbols(['BTCUSD', 'EURUSD']);
    sockets[0].quote();
    expect(sockets).toHaveLength(1);
    expect(sockets[0].sent).toEqual([{ p: '/subscribe/addlist', d: ['BTCUSD', 'EURUSD'] }]);
    quotes.setSymbols(['EURUSD', 'ETHUSD']);
    expect(sockets[0].sent.slice(1)).toEqual([
      { p: '/subscribe/removelist', d: ['BTCUSD'] },
      { p: '/subscribe/addlist', d: ['ETHUSD'] },
    ]);
  });

  it('merges partial batches, ignores acknowledgements and accepts equal timestamps', () => {
    quotes.setSymbols(['BTCUSD', 'EURUSD']);
    sockets[0].open();
    sockets[0].message({ p: '/subscribe/addlist', i: 0 });
    expect(quotes.quotes().size).toBe(0);
    sockets[0].quote('BTCUSD', 110, 10);
    sockets[0].quote('EURUSD', 1.1, 10);
    sockets[0].quote('BTCUSD', 111, 10);
    sockets[0].quote('BTCUSD', 99, 9);
    expect(quotes.quotes().size).toBe(2);
    expect(quotes.quotes().get('BTCUSD')).toMatchObject({ bid: 111, timestamp: 10000 });
    expect(quotes.isFresh('BTCUSD')).toBe(true);
  });

  it('survives malformed JSON and invalid quote rows while accepting valid rows', () => {
    quotes.setSymbols(['BTCUSD']);
    sockets[0].open();
    for (const message of ['{', 'null', '[]', '{"p":"/quotes/subscribed","d":null}'])
      sockets[0].message(message);
    sockets[0].message({
      p: '/quotes/subscribed',
      d: [null, { s: 'BTCUSD', b: 'bad', a: 1, t: 1 }, { s: 'BTCUSD', b: 110, a: 111, t: 1 }],
    });
    sockets[0].message('{"p":"/quotes/subscribed","d":[{"s":"BTCUSD","b":1e999,"a":2,"t":1}]}');
    sockets[0].quote('UNSUBSCRIBED');
    expect(quotes.quotes().size).toBe(1);
    expect(quotes.quotes().get('BTCUSD')?.bid).toBe(110);
  });

  it('keeps old results but requires a new quote after reconnect', () => {
    quotes.setSymbols(['BTCUSD']);
    sockets[0].open();
    sockets[0].quote();
    sockets[0].fail();
    expect(quotes.status()).toBe('reconnecting');
    expect(quotes.isFresh('BTCUSD')).toBe(false);
    expect(quotes.quotes().get('BTCUSD')?.bid).toBe(110);
    quotes.setSymbols(['BTCUSD', 'EURUSD']);
    vi.advanceTimersByTime(1000);
    sockets[1].open();
    expect(sockets[1].sent).toEqual([{ p: '/subscribe/addlist', d: ['BTCUSD', 'EURUSD'] }]);
    expect(quotes.isFresh('BTCUSD')).toBe(false);
    sockets[1].quote();
    expect(quotes.isFresh('BTCUSD')).toBe(true);
  });

  it('invalidates a price when unsubscribing and ignores late messages', () => {
    quotes.setSymbols(['BTCUSD']);
    sockets[0].open();
    sockets[0].quote();
    quotes.setSymbols([]);
    sockets[0].quote('BTCUSD', 999);
    expect(quotes.quotes().get('BTCUSD')?.bid).toBe(110);
    quotes.setSymbols(['BTCUSD']);
    expect(quotes.isFresh('BTCUSD')).toBe(false);
    sockets[0].quote('BTCUSD', 112);
    expect(quotes.isFresh('BTCUSD')).toBe(true);
  });

  it('backs off at 1, 2, 4, 8, 16 and at most 30 seconds', () => {
    quotes.setSymbols(['BTCUSD']);
    for (const seconds of [1, 2, 4, 8, 16, 30, 30]) {
      sockets.at(-1)!.fail();
      expect(quotes.retryDelay()).toBe(seconds);
      const count = sockets.length;
      vi.advanceTimersByTime(seconds * 1000 - 1);
      expect(sockets).toHaveLength(count);
      vi.advanceTimersByTime(1);
      expect(sockets).toHaveLength(count + 1);
    }
    sockets.at(-1)!.open();
    sockets.at(-1)!.fail();
    expect(quotes.retryDelay()).toBe(1);
  });

  it('times out a hanging connection and cleans up retry timers on destroy', () => {
    quotes.setSymbols(['BTCUSD']);
    vi.advanceTimersByTime(10000);
    expect(sockets[0].closeCount).toBe(1);
    expect(quotes.status()).toBe('reconnecting');
    TestBed.resetTestingModule();
    vi.advanceTimersByTime(60000);
    expect(sockets).toHaveLength(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('detects an open socket that stops answering subscription probes', () => {
    quotes.setSymbols(['BTCUSD']);
    sockets[0].open();
    vi.advanceTimersByTime(30_000);
    expect(sockets[0].sent.at(-1)).toEqual({ p: '/subscribe/addlist', d: ['BTCUSD'] });
    sockets[0].message('{');
    sockets[0].message({ p: '/quotes/subscribed', d: [{ s: 'BTCUSD', b: 'bad' }] });
    vi.advanceTimersByTime(10_000);
    expect(sockets[0].closeCount).toBe(1);
    expect(quotes.status()).toBe('reconnecting');
    vi.advanceTimersByTime(1_000);
    expect(sockets).toHaveLength(2);
  });

  it('accepts a probe acknowledgement without any market ticks', () => {
    quotes.setSymbols(['BTCUSD']);
    sockets[0].open();
    vi.advanceTimersByTime(30_000);
    sockets[0].message({ p: '/subscribe/addlist', i: 0 });
    vi.advanceTimersByTime(39_999);
    expect(quotes.status()).toBe('connected');
    expect(sockets[0].closeCount).toBe(0);
    expect(quotes.isFresh('BTCUSD')).toBe(false);
  });

  it('accepts valid quote traffic as proof of transport life', () => {
    quotes.setSymbols(['BTCUSD']);
    sockets[0].open();
    vi.advanceTimersByTime(30_000);
    sockets[0].quote();
    vi.advanceTimersByTime(10_000);
    expect(quotes.status()).toBe('connected');
    expect(sockets[0].closeCount).toBe(0);
  });

  it('closes a live socket and removes its handlers on destroy', () => {
    quotes.setSymbols(['BTCUSD']);
    sockets[0].open();
    TestBed.resetTestingModule();
    expect(sockets[0].closeCount).toBe(1);
    expect(sockets[0].onmessage).toBeNull();
    expect(sockets[0].onclose).toBeNull();
    expect(vi.getTimerCount()).toBe(0);
  });
});
