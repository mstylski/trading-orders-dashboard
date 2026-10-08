import { bootstrapApplication } from '@angular/platform-browser';
import { appConfig } from './app/app.config';
import { OrdersPage } from './app/features/orders/orders-page';

bootstrapApplication(OrdersPage, appConfig)
  .catch((err) => console.error(err));
