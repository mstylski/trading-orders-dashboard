import { Controller, Get } from '@nestjs/common';
import { ContractTypesService } from './contract-types.service';

@Controller('contract-types')
export class ContractTypesController {
  constructor(private readonly contractTypes: ContractTypesService) {}

  @Get()
  list() {
    return this.contractTypes.list();
  }
}
