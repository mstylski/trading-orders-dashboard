import { Injectable, InternalServerErrorException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

interface ContractType {
  readonly contractType: number;
  readonly contractSize: number;
}

@Injectable()
export class ContractTypesService {
  constructor(private readonly prisma: PrismaService) {}

  async list(): Promise<ContractType[]> {
    const contractTypes = await this.prisma.client.contractType.findMany({
      select: { contractType: true, contractSize: true },
      orderBy: { contractType: 'asc' },
    });
    return contractTypes.map(({ contractType, contractSize }) => {
      // JSON numbers must preserve the positive Decimal value on a round trip.
      const size = contractSize.toNumber();
      if (!Number.isFinite(size) || size <= 0 || !contractSize.equals(size.toString())) {
        throw new InternalServerErrorException({
          statusCode: 500,
          message: 'Internal server error',
        });
      }
      return { contractType, contractSize: size };
    });
  }
}
