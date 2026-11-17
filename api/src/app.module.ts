import { Module, ValidationPipe } from '@nestjs/common';
import { APP_PIPE } from '@nestjs/core';
import { ContractTypesModule } from './contract-types/contract-types.module';
import { InstrumentsModule } from './instruments/instruments.module';
import { OrdersModule } from './orders/orders.module';

@Module({
  imports: [OrdersModule, InstrumentsModule, ContractTypesModule],
  providers: [
    {
      provide: APP_PIPE,
      useFactory: () =>
        new ValidationPipe({
          whitelist: true,
          forbidNonWhitelisted: true,
          transform: true,
        }),
    },
  ],
})
export class AppModule {}
