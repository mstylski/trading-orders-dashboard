import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { forkJoin, map, Observable, timeout } from 'rxjs';
import { OrdersData } from '../models/order.models';
import { isContract, isInstrument, isOrder, validateList } from './order.guards';
import { isRecord } from '../../../shared/util/type-guards';
import { ORDERS_DATA_CONFIG } from './orders-data.config';

@Injectable({ providedIn: 'root' })
export class OrdersApiService {
  private readonly http = inject(HttpClient);
  private readonly config = inject(ORDERS_DATA_CONFIG);

  load(): Observable<OrdersData> {
    const requestOptions = { timeout: 5_000 };
    const base = this.config.apiBaseUrl.replace(/\/$/, '');
    return forkJoin({
      orders: this.http.get<unknown>(`${base}/orders`, requestOptions),
      instruments: this.http.get<unknown>(`${base}/instruments`, requestOptions),
      contracts: this.http.get<unknown>(`${base}/contract-types`, requestOptions),
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
