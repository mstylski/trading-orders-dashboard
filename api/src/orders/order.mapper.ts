import { Prisma } from '../../prisma/generated/client';
import { invalidOrder } from './invalid-order';
import { Order } from './order.models';

function decimalNumber(value: Prisma.Decimal, positive: boolean): number {
  const number = value.toNumber();
  // As in contract types, JSON's decimal text must round-trip without loss.
  // Swap may be negative or zero; sizes and opening prices must be positive.
  if (!Number.isFinite(number) || (positive && number <= 0) || !value.equals(number.toString())) {
    invalidOrder();
  }
  return number;
}

export const orderSelect = {
  id: true,
  symbol: true,
  side: true,
  size: true,
  openPrice: true,
  openTime: true,
  swap: true,
} satisfies Prisma.OrderSelect;

export function toOrder(row: Prisma.OrderGetPayload<{ select: typeof orderSelect }>): Order {
  if (row.id <= 0n || row.id > BigInt(Number.MAX_SAFE_INTEGER)) invalidOrder();
  if (row.side !== 'BUY' && row.side !== 'SELL') invalidOrder();
  const openTime = row.openTime.getTime();
  if (!Number.isSafeInteger(openTime)) invalidOrder();
  return {
    id: Number(row.id),
    symbol: row.symbol,
    side: row.side,
    size: decimalNumber(row.size, true),
    openPrice: decimalNumber(row.openPrice, true),
    openTime,
    swap: decimalNumber(row.swap, false),
  };
}
