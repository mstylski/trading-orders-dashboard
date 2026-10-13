import { Quote } from '../models/order.models';
import { isFiniteNumber, isRecord } from '../../../shared/util/type-guards';

export function parseQuoteMessage(
  data: unknown,
  subscribedSymbols: ReadonlySet<string>,
): readonly Quote[] {
  if (typeof data !== 'string') return [];
  let message: unknown;
  try {
    message = JSON.parse(data);
  } catch {
    return [];
  }
  if (!isRecord(message) || message['p'] !== '/quotes/subscribed' || !Array.isArray(message['d']))
    return [];
  return message['d'].flatMap((item: unknown) => {
    if (
      !isRecord(item) ||
      typeof item['s'] !== 'string' ||
      !subscribedSymbols.has(item['s']) ||
      !isFiniteNumber(item['b']) ||
      item['b'] < 0 ||
      !isFiniteNumber(item['a']) ||
      item['a'] < 0 ||
      !isFiniteNumber(item['t']) ||
      item['t'] < 0 ||
      !Number.isFinite(item['t'] * 1000)
    )
      return [];
    return [
      {
        symbol: item['s'],
        bid: item['b'],
        ask: item['a'],
        timestamp: item['t'] * 1000,
      },
    ];
  });
}
