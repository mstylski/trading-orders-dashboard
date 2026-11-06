import { ApplicationConfig, LOCALE_ID, provideBrowserGlobalErrorListeners } from '@angular/core';
import { provideHttpClient } from '@angular/common/http';
import { registerLocaleData } from '@angular/common';
import localePl from '@angular/common/locales/pl';
import { provideClientHydration } from '@angular/platform-browser';
import { ORDERS_DATA_CONFIG, ordersDataConfig } from './features/orders/data/orders-data.config';

registerLocaleData(localePl);

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideHttpClient(),
    { provide: LOCALE_ID, useValue: 'pl' },
    provideClientHydration(),
    { provide: ORDERS_DATA_CONFIG, useValue: ordersDataConfig },
  ],
};
