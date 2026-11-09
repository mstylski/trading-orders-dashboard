import { createPrismaClient } from './client';
import { loadFixtures } from './fixtures';

async function main() {
  const fixtures = loadFixtures();
  const prisma = createPrismaClient();
  try {
    // Development snapshot: replace all three tables atomically. Delete children
    // first, then insert parents first so that RESTRICT foreign keys stay valid.
    await prisma.$transaction(async (tx) => {
      await tx.order.deleteMany();
      await tx.instrument.deleteMany();
      await tx.contractType.deleteMany();
      await tx.contractType.createMany({ data: fixtures.contracts });
      await tx.instrument.createMany({ data: fixtures.instruments });
      await tx.order.createMany({ data: fixtures.orders });
    });
    console.log('Seeded development snapshot: 6 contract types, 108 instruments, 213 orders.');
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
