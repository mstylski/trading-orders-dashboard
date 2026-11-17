import { ConflictException } from '@nestjs/common';
import { ApiErrorCode } from '../../contracts/api-error-code';
import { Prisma } from '../../prisma/generated/client';
import { invalidOrder } from './invalid-order';
import { CreationResult, Order } from './order.models';

export const creationScope = 'POST /orders';

export function replayCreation(
  saved: { requestHash: string; statusCode: number | null; responseBody: Prisma.JsonValue },
  requestHash: string,
): CreationResult {
  if (saved.requestHash !== requestHash) {
    throw new ConflictException({
      statusCode: 409,
      code: ApiErrorCode.IdempotencyKeyReused,
      message: 'Idempotency-Key was already used with a different request',
    });
  }
  if (saved.statusCode === null || saved.responseBody === null) invalidOrder();
  return {
    statusCode: saved.statusCode,
    body: saved.responseBody as unknown as { data: Order },
  };
}
