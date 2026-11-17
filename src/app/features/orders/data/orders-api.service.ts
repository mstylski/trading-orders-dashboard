import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { forkJoin, map, Observable, timeout } from 'rxjs';
import { CreateOrderRequest, Order, OrdersData } from '../models/order.models';
import {
  InvalidPayloadError,
  isContract,
  isInstrument,
  isOrder,
  validateList,
} from './order.guards';
import { isRecord } from '../../../shared/util/type-guards';
import { ORDERS_DATA_CONFIG } from './orders-data.config';

@Injectable({ providedIn: 'root' })
export class OrdersApiService {
  private readonly http = inject(HttpClient);
  private readonly baseUrl = inject(ORDERS_DATA_CONFIG).apiBaseUrl.replace(/\/$/, '');

  resolveCreation(key: string): Observable<Order> {
    return this.http
      .get<unknown>(`${this.baseUrl}/orders/operations/${encodeURIComponent(key)}`, {
        observe: 'response',
        timeout: 5_000,
        transferCache: false,
      })
      .pipe(
        map((response) => {
          const order: unknown = isRecord(response.body) ? response.body['data'] : undefined;
          if (response.status !== 201 || !isOrder(order)) throw new InvalidPayloadError('orders');
          return order;
        }),
      );
  }

  create(input: CreateOrderRequest, idempotencyKey: string): Observable<Order> {
    return this.http
      .post<unknown>(`${this.baseUrl}/orders`, input, {
        observe: 'response',
        timeout: 5_000,
        headers: { 'Idempotency-Key': idempotencyKey },
      })
      .pipe(
        map((response) => {
          const order: unknown = isRecord(response.body) ? response.body['data'] : undefined;
          if (response.status !== 201 || !isOrder(order)) throw new InvalidPayloadError('orders');
          return order;
        }),
      );
  }

  load(): Observable<OrdersData> {
    const requestOptions = { timeout: 5_000 };
    return forkJoin({
      orders: this.http.get<unknown>(`${this.baseUrl}/orders`, requestOptions),
      instruments: this.http.get<unknown>(`${this.baseUrl}/instruments`, requestOptions),
      contracts: this.http.get<unknown>(`${this.baseUrl}/contract-types`, requestOptions),
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
