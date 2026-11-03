import { BootstrapContext, bootstrapApplication } from '@angular/platform-browser';
import { OrdersPage } from './app/features/orders/orders-page';
import { config } from './app/app.config.server';

const bootstrap = (context: BootstrapContext) => bootstrapApplication(OrdersPage, config, context);

export default bootstrap;
