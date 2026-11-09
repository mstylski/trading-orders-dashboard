import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

interface Instrument {
  readonly symbol: string;
  readonly contractType: number;
}

@Injectable()
export class InstrumentsService {
  constructor(private readonly prisma: PrismaService) {}

  async list(): Promise<Instrument[]> {
    const instruments = await this.prisma.client.instrument.findMany({
      select: { symbol: true, contractType: true },
    });
    // Preserve the fixture's symbol order regardless of PostgreSQL collation.
    return instruments
      .map(({ symbol, contractType }) => ({ symbol, contractType }))
      .sort((a, b) => (a.symbol < b.symbol ? -1 : a.symbol > b.symbol ? 1 : 0));
  }
}
