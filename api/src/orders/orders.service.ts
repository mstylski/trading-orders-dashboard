import { BadRequestException, Injectable, InternalServerErrorException } from '@nestjs/common';
import { Prisma } from '../../prisma/generated/client';
import { PrismaService } from '../prisma/prisma.service';

interface Order {
  readonly id: number;
  readonly symbol: string;
  readonly side: 'BUY' | 'SELL';
  readonly size: number;
  readonly openPrice: number;
  readonly openTime: number;
  readonly swap: number;
}

function invalidOrder(): never {
  throw new InternalServerErrorException({ statusCode: 500, message: 'Internal server error' });
}

function decimalNumber(value: Prisma.Decimal, positive: boolean): number {
  const number = value.toNumber();
  // As in contract types, JSON's decimal text must round-trip without loss.
  // Swap may be negative or zero; sizes and opening prices must be positive.
  if (!Number.isFinite(number) || (positive && number <= 0) || !value.equals(number.toString())) {
    invalidOrder();
  }
  return number;
}

@Injectable()
export class OrdersService {
  constructor(private readonly prisma: PrismaService) {}

  async list(status?: string): Promise<{ data: Order[] }> {
    if (status !== undefined && typeof status !== 'string') {
      throw new BadRequestException('status must be open or closed');
    }
    const normalizedStatus = status?.toLowerCase();
    if (
      normalizedStatus !== undefined &&
      normalizedStatus !== 'open' &&
      normalizedStatus !== 'closed'
    ) {
      throw new BadRequestException('status must be open or closed');
    }
    if (normalizedStatus === 'closed') return { data: [] };

    const orders = await this.prisma.client.$transaction(
      async (tx) => {
        // Prisma Date has millisecond precision; inspect the stored timestamp
        // before conversion. Both reads must see the same PostgreSQL snapshot.
        const subMillisecondTimes = await tx.$queryRaw<{ id: bigint }[]>`
          SELECT id FROM public.orders
          WHERE open_time <> date_trunc('milliseconds', open_time)
          LIMIT 1
        `;
        if (subMillisecondTimes.length) invalidOrder();
        return tx.order.findMany({
          select: {
            id: true,
            symbol: true,
            side: true,
            size: true,
            openPrice: true,
            openTime: true,
            swap: true,
          },
          // Preserve the snapshot's arbitrary group order. New rows follow it
          // deterministically; displayOrder is internal and never enters JSON.
          orderBy: [{ displayOrder: { sort: 'asc', nulls: 'last' } }, { id: 'asc' }],
        });
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );

    return {
      data: orders.map((row) => {
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
      }),
    };
  }
}
