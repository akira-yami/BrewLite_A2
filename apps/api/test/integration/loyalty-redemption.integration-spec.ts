// Kiểm tra đổi điểm đồng thời và phát lại cùng khóa trên PostgreSQL.
import { PrismaPg } from '@prisma/adapter-pg';
import { randomUUID } from 'node:crypto';
import { PrismaClient } from '../../src/generated/prisma/client.js';
import { LoyaltyRepository } from '../../src/modules/loyalty/repositories/loyalty.repository.js';
import type { LoyaltyTier } from '../../src/modules/loyalty/entities/loyalty-tier.entity.js';

const connectionString = process.env.SMOKE_DATABASE_URL;
const databaseName = connectionString ? new URL(connectionString).pathname.slice(1) : '';
const isolatedSmokeDatabase = databaseName.startsWith('brewlite_foundation_smoke');
const reward: LoyaltyTier = { tierId: '10000', pointsCost: 10000, discountAmount: 10000, minOrderValue: 20000 };

describe.skipIf(!isolatedSmokeDatabase)('Loyalty redemption PostgreSQL atomicity', () => {
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: connectionString! }) });
  const repository = new LoyaltyRepository(prisma as never);

  async function withCustomer(run: (userId: string) => Promise<void>) {
    const username = `loyalty-${randomUUID()}`;
    const user = await prisma.user.create({
      data: { username, passwordHash: 'not-used-in-test', loyaltyBalance: reward.pointsCost },
    });
    try {
      await run(user.id);
    } finally {
      const ledger = await prisma.loyaltyTransaction.findMany({ where: { userId: user.id }, select: { reason: true } });
      const codes = ledger.map(({ reason }) => /(?:^|;)coupon=([A-Z0-9-]+)(?:;|$)/.exec(reason)?.[1]).filter((code): code is string => Boolean(code));
      await prisma.loyaltyTransaction.deleteMany({ where: { userId: user.id } });
      if (codes.length) await prisma.coupon.deleteMany({ where: { code: { in: codes } } });
      await prisma.user.delete({ where: { id: user.id } });
    }
  }

  afterAll(async () => prisma.$disconnect());

  it('Hai lượt đổi điểm đồng thời với khóa khác nhau không thể tiêu điểm hai lần', async () => {
    await withCustomer(async (userId) => {
      const results = await Promise.allSettled([
        repository.redeem(userId, reward, randomUUID()),
        repository.redeem(userId, reward, randomUUID()),
      ]);
      expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
      expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1);
      expect(await prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { loyaltyBalance: true } }))
        .toEqual({ loyaltyBalance: 0 });
      expect(await prisma.loyaltyTransaction.count({ where: { userId, type: 'REDEEM' } })).toBe(1);
    });
  });

  it('Thử lại đồng thời với cùng khóa trả về cùng coupon', async () => {
    await withCustomer(async (userId) => {
      const key = randomUUID();
      const [first, retry] = await Promise.all([
        repository.redeem(userId, reward, key),
        repository.redeem(userId, reward, key),
      ]);
      expect(first.coupon.code).toBe(retry.coupon.code);
      expect(await prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { loyaltyBalance: true } }))
        .toEqual({ loyaltyBalance: 0 });
      expect(await prisma.loyaltyTransaction.count({ where: { userId, type: 'REDEEM' } })).toBe(1);
    });
  });
});
