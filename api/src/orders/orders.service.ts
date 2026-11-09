import { BadRequestException, Injectable } from '@nestjs/common';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

interface Order {
  readonly id: number;
  readonly symbol: string;
  readonly side: 'BUY' | 'SELL';
  readonly size: number;
  readonly openPrice: number;
  readonly openTime: number;
  readonly swap: number;
}

interface ContractType {
  readonly contractType: number;
  readonly contractSize: number;
}

function readFixture<T>(name: string): T {
  return JSON.parse(readFileSync(join(__dirname, '..', '..', 'data', name), 'utf8')) as T;
}

@Injectable()
export class OrdersService {
  private readonly orders = readFixture<{ data: Order[] }>('order-data.json').data;
  private readonly contractTypeList = readFixture<ContractType[]>('contract-types.json');

  list(status?: string) {
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
    return {
      data: normalizedStatus === 'closed' ? [] : this.orders,
    };
  }

  contractTypes(): readonly ContractType[] {
    return this.contractTypeList;
  }
}
