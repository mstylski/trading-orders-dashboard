import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { forkJoin, map, Observable, timeout } from 'rxjs';
import { OrdersData } from '../models/order.models';
import { isContract, isInstrument, isOrder, validateList } from './order.guards';
import { isRecord } from '../../../shared/util/type-guards';

export const ORDERS_API = 'https://geeksoft.pl/assets/2026-task';

@Injectable({ providedIn: 'root' })
export class OrdersApiService {
  private readonly http = inject(HttpClient);

  load(): Observable<OrdersData> {
    const requestOptions = { timeout: 5_000 };
    return forkJoin({
      orders: this.http.get<unknown>(`${ORDERS_API}/order-data.json`, requestOptions),
      instruments: this.http.get<unknown>(`${ORDERS_API}/instruments.json`, requestOptions),
      contracts: this.http.get<unknown>(`${ORDERS_API}/contract-types.json`, requestOptions),
    }).pipe(
      timeout({ first: 5_000 }),
      map(({ orders, instruments, contracts }) => ({
        orders: validateList(
          isRecord(orders) ? orders['data'] : undefined,
          isOrder,
          (order) => order.id,
          'orders',
        ),
        instruments: validateList(
          instruments,
          isInstrument,
          (instrument) => instrument.symbol,
          'instruments',
        ),
        contracts: validateList(
          contracts,
          isContract,
          (contract) => contract.contractType,
          'contracts',
        ),
      })),
    );
  }
}
