import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PromotionsRepository } from './promotions.repository.js';
import { PrismaService } from '../../../database/prisma.service.js';

describe('PromotionsRepository (Unit Test - TDD)', () => {
    let repository: PromotionsRepository;
    let prismaMock: any;
    const fixedNow = new Date('2026-10-22T08:00:00.000Z');

    beforeEach(() => {
        prismaMock = {
        $queryRaw: vi.fn(),
        coupon: {
            findUnique: vi.fn(),
        },
        couponRedemption: {
            count: vi.fn(),
            create: vi.fn(),
            updateMany: vi.fn(),
        },
        };
        repository = new PromotionsRepository(
        prismaMock as unknown as PrismaService,
        );
    });

    it('findByCode - nên gọi prisma.coupon.findUnique (hỗ trợ cả tx)', async () => {
        const mockCoupon = { id: 'c-1', code: 'WELCOME10' };
        prismaMock.coupon.findUnique.mockResolvedValue(mockCoupon);

        const result = await repository.findByCode('WELCOME10', prismaMock);

        expect(prismaMock.coupon.findUnique).toHaveBeenCalledWith({
        where: { code: 'WELCOME10' },
        });
        expect(result).toEqual(mockCoupon);
    });

    it('lockCoupon - nên gọi tx.$queryRaw để khóa dòng bằng FOR UPDATE', async () => {
        prismaMock.$queryRaw.mockResolvedValue([
        {
            id: 'c-1',
            code: 'WELCOME10',
            discount_type: 'PERCENTAGE',
            discount_value: 10n,
            max_discount: 20000n,
            min_order_value: 50000n,
            usage_limit: 100,
            per_user_limit: 1,
            starts_at: new Date('2026-10-01T00:00:00Z'),
            ends_at: new Date('2026-11-01T00:00:00Z'),
            is_active: true,
            created_at: fixedNow,
            updated_at: fixedNow,
        },
        ]);

        const result = await repository.lockCoupon('WELCOME10', prismaMock);

        expect(prismaMock.$queryRaw).toHaveBeenCalled();
        expect(result).toMatchObject({
        id: 'c-1',
        code: 'WELCOME10',
        discountType: 'PERCENTAGE',
        discountValue: 10n,
        maxDiscount: 20000n,
        minOrderValue: 50000n,
        usageLimit: 100,
        perUserLimit: 1,
        isActive: true,
        });
    });

    it('lockCoupon - trả về null nếu không tìm thấy mã coupon', async () => {
        prismaMock.$queryRaw.mockResolvedValue([]);
        const result = await repository.lockCoupon('NOT_FOUND', prismaMock);
        expect(result).toBeNull();
    });

    it('countRedemptions - đếm CONSUMED và RESERVED còn hạn hoặc đang thanh toán theo userId', async () => {
        prismaMock.couponRedemption.count.mockResolvedValue(1);

        const result = await repository.countRedemptions(
        'c-1',
        'u-1',
        fixedNow,
        prismaMock,
        );

        expect(prismaMock.couponRedemption.count).toHaveBeenCalledWith({
        where: {
            couponId: 'c-1',
            userId: 'u-1',
            OR: [
            { status: 'CONSUMED' },
            { status: 'RESERVED', OR: [
              { expiresAt: { gt: fixedNow } },
              { order: { payments: { some: { status: 'PROCESSING' } } } },
            ] },
            ],
        },
        });
        expect(result).toBe(1);
    });

    it('countTotalRedemptions - đếm CONSUMED và RESERVED còn hạn hoặc đang thanh toán toàn cục', async () => {
        prismaMock.couponRedemption.count.mockResolvedValue(5);

        const result = await repository.countTotalRedemptions(
        'c-1',
        fixedNow,
        prismaMock,
        );

        expect(prismaMock.couponRedemption.count).toHaveBeenCalledWith({
        where: {
            couponId: 'c-1',
            OR: [
            { status: 'CONSUMED' },
            { status: 'RESERVED', OR: [
              { expiresAt: { gt: fixedNow } },
              { order: { payments: { some: { status: 'PROCESSING' } } } },
            ] },
            ],
        },
        });
        expect(result).toBe(5);
    });

    it('createRedemption - tạo bản ghi trạng thái RESERVED', async () => {
        prismaMock.couponRedemption.create.mockResolvedValue({ id: 'r-1' });
        const expiresAt = new Date('2026-10-22T08:15:00.000Z');

        const result = await repository.createRedemption(
        {
            couponId: 'c-1',
            userId: 'u-1',
            orderId: 'o-1',
            discountAmount: 15000n,
            expiresAt,
        },
        prismaMock,
        );

        expect(prismaMock.couponRedemption.create).toHaveBeenCalledWith({
        data: {
            couponId: 'c-1',
            userId: 'u-1',
            orderId: 'o-1',
            discountAmount: 15000n,
            expiresAt,
            status: 'RESERVED',
        },
        });
        expect(result.id).toBe('r-1');
    });

    it('consumeByOrderId - chuyển RESERVED -> CONSUMED có điều kiện status = RESERVED', async () => {
        prismaMock.couponRedemption.updateMany.mockResolvedValue({ count: 1 });

        const count = await repository.consumeByOrderId('o-1', fixedNow, prismaMock);

        expect(prismaMock.couponRedemption.updateMany).toHaveBeenCalledWith({
        where: { orderId: 'o-1', status: 'RESERVED' },
        data: { status: 'CONSUMED', consumedAt: fixedNow },
        });
        expect(count).toBe(1);
    });

    it('releaseByOrderId - chuyển RESERVED -> RELEASED hoặc EXPIRED có điều kiện status = RESERVED', async () => {
        prismaMock.couponRedemption.updateMany.mockResolvedValue({ count: 1 });

        const count = await repository.releaseByOrderId(
        'o-1',
        'EXPIRED',
        fixedNow,
        prismaMock,
        );

        expect(prismaMock.couponRedemption.updateMany).toHaveBeenCalledWith({
        where: { orderId: 'o-1', status: 'RESERVED' },
        data: { status: 'EXPIRED', releasedAt: fixedNow },
        });
        expect(count).toBe(1);
    });
});