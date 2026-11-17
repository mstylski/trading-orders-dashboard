import { isRecord } from '../../../shared/util/type-guards';
import { CreateOrderRequest, NewOrder } from '../models/order.models';

export interface PendingOrder {
  readonly key: string;
  readonly request: CreateOrderRequest;
}

export interface LegacyPendingOrder {
  readonly key: string;
  readonly request: CreateOrderRequest & { readonly openTime: number };
}

export function readLegacyPending(value: unknown): LegacyPendingOrder | null {
  if (!isRecord(value) || !isRecord(value['request'])) return null;
  const request = value['request'];
  const openTime = request['openTime'];
  if (
    Object.keys(request).length !== 5 ||
    typeof openTime !== 'number' ||
    !Number.isSafeInteger(openTime) ||
    openTime < -62135596800000 ||
    openTime > 253402300799999
  )
    return null;
  const currentRequest = {
    symbol: request['symbol'],
    side: request['side'],
    size: request['size'],
    openPrice: request['openPrice'],
  };
  const current = readPending({ key: value['key'], request: currentRequest });
  return current ? { key: current.key, request: { ...current.request, openTime } } : null;
}

export function sameOrder(left: NewOrder, right: NewOrder): boolean {
  return left.symbol === right.symbol && left.side === right.side && left.size === right.size;
}

export function validInput(input: NewOrder): boolean {
  return (
    typeof input.symbol === 'string' &&
    /\S/.test(input.symbol) &&
    (input.side === 'BUY' || input.side === 'SELL') &&
    Number.isFinite(input.size) &&
    input.size > 0
  );
}

export function readPending(value: unknown): PendingOrder | null {
  if (
    !isRecord(value) ||
    typeof value['key'] !== 'string' ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      value['key'],
    ) ||
    !isRecord(value['request'])
  )
    return null;
  const request = value['request'];
  if (
    Object.keys(request).length !== 4 ||
    typeof request['symbol'] !== 'string' ||
    (request['side'] !== 'BUY' && request['side'] !== 'SELL') ||
    typeof request['size'] !== 'number' ||
    typeof request['openPrice'] !== 'number' ||
    !Number.isFinite(request['openPrice']) ||
    request['openPrice'] <= 0
  )
    return null;
  const input: CreateOrderRequest = {
    symbol: request['symbol'],
    side: request['side'],
    size: request['size'],
    openPrice: request['openPrice'],
  };
  return validInput(input) ? { key: value['key'], request: input } : null;
}
