import { Module } from '@nestjs/common';
import { ContractTypesModule } from './contract-types/contract-types.module';
import { InstrumentsModule } from './instruments/instruments.module';
import { OrdersModule } from './orders/orders.module';

@Module({ imports: [OrdersModule, InstrumentsModule, ContractTypesModule] })
export class AppModule {}
