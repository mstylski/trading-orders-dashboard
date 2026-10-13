import { parseQuoteMessage } from './quote-message.guards';

describe('parseQuoteMessage', () => {
  it('returns valid subscribed quotes from a mixed batch', () => {
    const message = JSON.stringify({
      p: '/quotes/subscribed',
      d: [
        { s: 'BTCUSD', b: 110, a: 111, t: 10 },
        { s: 'EURUSD', b: 1.1, a: 1.2, t: 10 },
        { s: 'BTCUSD', b: -1, a: 111, t: 11 },
      ],
    });
    expect(parseQuoteMessage(message, new Set(['BTCUSD']))).toEqual([
      { symbol: 'BTCUSD', bid: 110, ask: 111, timestamp: 10_000 },
    ]);
    expect(parseQuoteMessage('{', new Set(['BTCUSD']))).toEqual([]);
  });
});
