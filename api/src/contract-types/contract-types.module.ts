import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { ContractTypesController } from './contract-types.controller';
import { ContractTypesService } from './contract-types.service';

@Module({
  imports: [PrismaModule],
  controllers: [ContractTypesController],
  providers: [ContractTypesService],
})
export class ContractTypesModule {}
