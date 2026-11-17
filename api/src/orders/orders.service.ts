import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { isUUID } from 'class-validator';
import { Prisma } from '../../prisma/generated/client';
import { PrismaService } from '../prisma/prisma.service';
import { CreateOrderDto } from './create-order.dto';
import { invalidOrder } from './invalid-order';
import { creationScope, replayCreation } from './order-creation';
import { orderSelect, toOrder } from './order.mapper';
import { CreationResult, Order } from './order.models';

@Injectable()
export class OrdersService {
  constructor(private readonly prisma: PrismaService) {}

  // Resolve an existing operation without submitting its legacy payload or
  // changing the request hash. A missing record never authorizes a new write.
  async findCreation(suppliedKey: string): Promise<CreationResult> {
    if (!isUUID(suppliedKey)) throw new BadRequestException('Operation key must be a UUID');
    const saved = await this.prisma.client.orderCreation.findUnique({
      where: { scope_key: { scope: creationScope, key: suppliedKey.toLowerCase() } },
    });
    if (!saved) throw new NotFoundException('Order operation not found');
    return replayCreation(saved, saved.requestHash);
  }

  async create(input: CreateOrderDto, suppliedKey: string | undefined): Promise<CreationResult> {
    if (typeof suppliedKey !== 'string' || !isUUID(suppliedKey)) {
      throw new BadRequestException('Idempotency-Key must be a UUID');
    }
    const key = suppliedKey.toLowerCase();
    // Hash only validated DTO fields, in a fixed order. JSON property ordering
    // and equivalent numeric spellings must not change request identity.
    const normalizedInput = {
      symbol: input.symbol,
      side: input.side,
      size: input.size,
      openPrice: input.openPrice,
    };
    const requestHash = createHash('sha256').update(JSON.stringify(normalizedInput)).digest('hex');
    const where = { scope_key: { scope: creationScope, key } };
    const existing = await this.prisma.client.orderCreation.findUnique({ where });
    if (existing) return replayCreation(existing, requestHash);

    try {
      return await this.prisma.client.$transaction(async (tx) => {
        // The unique reservation blocks concurrent requests until this complete
        // transaction commits or rolls back. No pending reservation is committed.
        await tx.orderCreation.create({ data: { scope: creationScope, key, requestHash } });
        const instrument = await tx.instrument.findUnique({
          where: { symbol: input.symbol },
          select: { symbol: true },
        });
        if (!instrument) throw new NotFoundException('Instrument not found');
        const row = await tx.order.create({
          data: {
            symbol: input.symbol,
            side: input.side,
            size: new Prisma.Decimal(input.size.toString()),
            openPrice: new Prisma.Decimal(input.openPrice.toString()),
            openTime: new Date(),
            swap: 0,
          },
          select: orderSelect,
        });
        const body = { data: { ...toOrder(row) } };
        await tx.orderCreation.update({
          where,
          data: { orderId: row.id, statusCode: 201, responseBody: body },
        });
        return { statusCode: 201, body };
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        // PostgreSQL has waited for the competing transaction. Read its durable
        // result outside our now-rolled-back transaction, including after restart.
        const saved = await this.prisma.client.orderCreation.findUnique({ where });
        if (saved) return replayCreation(saved, requestHash);
      }
      throw error;
    }
  }

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
          select: orderSelect,
          // Preserve the snapshot's arbitrary group order. New rows follow it
          // deterministically; displayOrder is internal and never enters JSON.
          orderBy: [{ displayOrder: { sort: 'asc', nulls: 'last' } }, { id: 'asc' }],
        });
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );

    return {
      data: orders.map(toOrder),
    };
  }
}
