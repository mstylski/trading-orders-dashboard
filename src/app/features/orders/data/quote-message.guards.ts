import { Quote } from '../models/order.models';
import { isFiniteNumber, isRecord } from '../../../shared/util/type-guards';

type RejectionReason = 'invalid structure' | 'missing field' | 'invalid value';

function logRejection(reason: RejectionReason, location: string): void {
  console.warn(`Rejected quote message (${reason}): ${location}`);
}

function hasField(record: Record<string, unknown>, field: string): boolean {
  return Object.hasOwn(record, field);
}

export function parseQuoteMessage(
  data: unknown,
  subscribedSymbols: ReadonlySet<string>,
): { quotes: readonly Quote[]; acknowledged: boolean } {
  const ignored = { quotes: [], acknowledged: false };
  if (typeof data !== 'string') {
    logRejection('invalid structure', 'message must be a JSON string');
    return ignored;
  }
  let message: unknown;
  try {
    message = JSON.parse(data);
  } catch {
    logRejection('invalid structure', 'message contains malformed JSON');
    return ignored;
  }
  if (!isRecord(message)) {
    logRejection('invalid structure', 'message must be an object');
    return ignored;
  }
  if (!hasField(message, 'p')) {
    logRejection('missing field', 'p');
    return ignored;
  }
  if (message['p'] === '/subscribe/addlist') {
    if (!hasField(message, 'i')) {
      logRejection('missing field', 'i');
      return ignored;
    }
    if (!isFiniteNumber(message['i'])) {
      logRejection('invalid value', 'i must be a finite number');
      return ignored;
    }
    return { quotes: [], acknowledged: true };
  }
  if (message['p'] !== '/quotes/subscribed') {
    logRejection('invalid value', 'p has an unsupported route');
    return ignored;
  }
  if (!hasField(message, 'd')) {
    logRejection('missing field', 'd');
    return ignored;
  }
  if (!Array.isArray(message['d'])) {
    logRejection('invalid structure', 'd must be an array');
    return ignored;
  }
  const quotes = message['d'].flatMap((item: unknown, index: number) => {
    const location = `d[${index}]`;
    if (!isRecord(item)) {
      logRejection('invalid structure', `${location} must be an object`);
      return [];
    }
    for (const field of ['s', 'b', 'a', 't']) {
      if (!hasField(item, field)) {
        logRejection('missing field', `${location}.${field}`);
        return [];
      }
    }
    if (typeof item['s'] !== 'string' || item['s'].length === 0) {
      logRejection('invalid value', `${location}.s must be a nonempty string`);
      return [];
    }
    if (!subscribedSymbols.has(item['s'])) return [];
    const bid = item['b'];
    const ask = item['a'];
    const time = item['t'];
    if (!isFiniteNumber(bid) || bid < 0) {
      logRejection('invalid value', `${location}.b must be a nonnegative finite number`);
      return [];
    }
    if (!isFiniteNumber(ask) || ask < 0) {
      logRejection('invalid value', `${location}.a must be a nonnegative finite number`);
      return [];
    }
    if (!isFiniteNumber(time) || time < 0) {
      logRejection('invalid value', `${location}.t must be a nonnegative finite number`);
      return [];
    }
    if (!Number.isFinite(time * 1000)) {
      logRejection('invalid value', `${location}.t exceeds the supported timestamp range`);
      return [];
    }
    return [
      {
        symbol: item['s'],
        bid,
        ask,
        timestamp: time * 1000,
      },
    ];
  });
  return { quotes, acknowledged: quotes.length > 0 };
}
