import { InjectionToken } from '@angular/core';

export interface OrdersDataConfig {
  readonly apiBaseUrl: string;
}

// Shared by browser and SSR.
export const ORDERS_DATA_CONFIG = new InjectionToken<OrdersDataConfig>('ORDERS_DATA_CONFIG');

export const ordersDataConfig: OrdersDataConfig = {
  apiBaseUrl: 'http://localhost:3000',
};
