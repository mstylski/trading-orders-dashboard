import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { createPrismaClient } from '../../prisma/client';

@Injectable()
export class PrismaService implements OnModuleDestroy {
  readonly client = createPrismaClient();

  async onModuleDestroy(): Promise<void> {
    await this.client.$disconnect();
  }
}
