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
    expect(parseQuoteMessage(message, new Set(['BTCUSD']))).toEqual({
      quotes: [{ symbol: 'BTCUSD', bid: 110, ask: 111, timestamp: 10_000 }],
      acknowledged: true,
    });
    expect(parseQuoteMessage('{', new Set(['BTCUSD']))).toEqual({
      quotes: [],
      acknowledged: false,
    });
  });

  it.each([
    ['invalid structure', '{', 'malformed JSON'],
    ['invalid structure', JSON.stringify({ p: '/quotes/subscribed', d: [null] }), 'd[0]'],
    [
      'missing field',
      JSON.stringify({ p: '/quotes/subscribed', d: [{ s: 'BTCUSD', a: 2, t: 1 }] }),
      'd[0].b',
    ],
    [
      'invalid value',
      JSON.stringify({ p: '/quotes/subscribed', d: [{ s: 'BTCUSD', b: -1, a: 2, t: 1 }] }),
      'd[0].b',
    ],
  ])('reports %s for rejected input', (reason, message, location) => {
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    try {
      expect(parseQuoteMessage(message, new Set(['BTCUSD']))).toEqual({
        quotes: [],
        acknowledged: false,
      });
      expect(warning).toHaveBeenCalledWith(expect.stringContaining(reason));
      expect(warning).toHaveBeenCalledWith(expect.stringContaining(location));
    } finally {
      warning.mockRestore();
    }
  });

  it('retains valid rows and silently ignores unsubscribed symbols', () => {
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    try {
      expect(
        parseQuoteMessage(
          JSON.stringify({
            p: '/quotes/subscribed',
            d: [
              { s: 'EURUSD', b: 1, a: 2, t: 1 },
              { s: 'BTCUSD', b: 3, a: 4, t: 1 },
            ],
          }),
          new Set(['BTCUSD']),
        ),
      ).toEqual({
        quotes: [{ symbol: 'BTCUSD', bid: 3, ask: 4, timestamp: 1000 }],
        acknowledged: true,
      });
      expect(warning).not.toHaveBeenCalled();
    } finally {
      warning.mockRestore();
    }
  });
});
