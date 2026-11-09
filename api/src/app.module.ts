import { Module } from '@nestjs/common';
import { InstrumentsModule } from './instruments/instruments.module';
import { OrdersModule } from './orders/orders.module';

@Module({ imports: [OrdersModule, InstrumentsModule] })
export class AppModule {}
