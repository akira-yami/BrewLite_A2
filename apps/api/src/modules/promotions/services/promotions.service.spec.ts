import { BadRequestException, UnprocessableEntityException } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PromotionsService } from './promotions.service.js';
import { PromotionsRepository } from '../repositories/promotions.repository.js';
import type { DiscountType } from '../../../generated/prisma/client.js';

describe('PromotionsService (Unit Test - TDD)', () => {
    let service: PromotionsService;
    let repositoryMock: any;
    const fixedNow = new Date('2026-10-22T08:00:00.000Z');

    const validCoupon = {
        id: 'c-1',
        code: 'WELCOME10',
        discountType: 'PERCENTAGE' as DiscountType,
        discountValue: 10n,
        maxDiscount: 20000n,
        minOrderValue: 50000n,
        usageLimit: 100,
        perUserLimit: 1,
        startsAt: new Date('2026-10-01T00:00:00Z'),
        endsAt: new Date('2026-11-01T00:00:00Z'),
        isActive: true,
    };

    beforeEach(() => {
        repositoryMock = {
            findByCode: vi.fn(),
            lockCoupon: vi.fn(),
            countRedemptions: vi.fn(),
            countTotalRedemptions: vi.fn(),
            createRedemption: vi.fn(),
            consumeByOrderId: vi.fn(),
            releaseByOrderId: vi.fn(),
        };
        service = new PromotionsService(repositoryMock as unknown as PromotionsRepository);
    });

    describe('validateCoupon (UC-07 Preview)', () => {
        it('Nên ném COUPON_NOT_APPLICABLE nếu mã không tồn tại hoặc inactive', async () => {
        repositoryMock.findByCode.mockResolvedValue(null);
        await expect(service.validateCoupon('INVALID', 100000, 'u-1', fixedNow))
            .rejects.toThrow(UnprocessableEntityException);

        repositoryMock.findByCode.mockResolvedValue({ ...validCoupon, isActive: false });
        await expect(service.validateCoupon('WELCOME10', 100000, 'u-1', fixedNow))
            .rejects.toThrow(UnprocessableEntityException);
        });

        it('Nên ném COUPON_NOT_APPLICABLE nếu ngoài thời gian áp dụng', async () => {
        const pastCoupon = { ...validCoupon, endsAt: new Date('2026-10-20T00:00:00Z') };
        repositoryMock.findByCode.mockResolvedValue(pastCoupon);
        await expect(service.validateCoupon('WELCOME10', 100000, 'u-1', fixedNow))
            .rejects.toThrow(UnprocessableEntityException);
        });

        it('Nên ném COUPON_NOT_APPLICABLE nếu chưa đạt giá trị đơn hàng tối thiểu', async () => {
        repositoryMock.findByCode.mockResolvedValue(validCoupon);
        await expect(service.validateCoupon('WELCOME10', 40000, 'u-1', fixedNow))
            .rejects.toThrow(UnprocessableEntityException);
        });

        it('Nên ném COUPON_NOT_APPLICABLE nếu vượt quá perUserLimit', async () => {
        repositoryMock.findByCode.mockResolvedValue(validCoupon);
        repositoryMock.countRedemptions.mockResolvedValue(1); // Đã dùng 1 lần, limit = 1
        await expect(service.validateCoupon('WELCOME10', 100000, 'u-1', fixedNow))
            .rejects.toThrow(UnprocessableEntityException);
        });

        it('Nên tính đúng PERCENTAGE discount có maxDiscount', async () => {
        repositoryMock.findByCode.mockResolvedValue(validCoupon);
        repositoryMock.countRedemptions.mockResolvedValue(0);
        repositoryMock.countTotalRedemptions.mockResolvedValue(0);

        // 10% của 300k = 30k -> Vượt max 20k -> Chỉ giảm 20k
        const result = await service.validateCoupon('WELCOME10', 300000, 'u-1', fixedNow);
        expect(result).toEqual({ code: 'WELCOME10', discountAmount: 20000 });
        });

        it('Nên tính đúng FIXED_AMOUNT discount không vượt quá subtotal', async () => {
            const fixedCoupon = {
                ...validCoupon,
                discountType: 'FIXED_AMOUNT' as DiscountType,
                discountValue: 50000n,
                minOrderValue: 0n // Ghi đè để vượt qua điều kiện kiểm tra subtotal
            };
            repositoryMock.findByCode.mockResolvedValue(fixedCoupon);
            repositoryMock.countRedemptions.mockResolvedValue(0);
            repositoryMock.countTotalRedemptions.mockResolvedValue(0);

            // Giảm 50k cho đơn 40k -> Chỉ giảm 40k
            const result = await service.validateCoupon('WELCOME10', 40000, 'u-1', fixedNow);
            expect(result).toEqual({ code: 'WELCOME10', discountAmount: 40000 });
        });

        it('Nên từ chối subtotal vượt Number.MAX_SAFE_INTEGER trước khi truy vấn coupon', async () => {
            const unsafeSubtotal = Number.MAX_SAFE_INTEGER + 1;

            await expect(
                service.validateCoupon('WELCOME10', unsafeSubtotal, 'u-1', fixedNow),
            ).rejects.toThrow(BadRequestException);

            expect(repositoryMock.findByCode).not.toHaveBeenCalled();
        });

        it('Preview và quote trong transaction phải trả cùng discount cho cùng coupon/subtotal', async () => {
            repositoryMock.findByCode.mockResolvedValue(validCoupon);
            repositoryMock.lockCoupon.mockResolvedValue(validCoupon);
            repositoryMock.countRedemptions.mockResolvedValue(0);
            repositoryMock.countTotalRedemptions.mockResolvedValue(0);
            const txMock = {} as any;

            const preview = await service.validateCoupon('WELCOME10', 300000, 'u-1', fixedNow);
            const lockedQuote = await service.quoteAndLock(
                txMock,
                'u-1',
                'WELCOME10',
                300000n,
                fixedNow,
            );

            // Cả hai đường đi phải dùng chung phép tính BigInt và maxDiscount.
            expect(preview.discountAmount).toBe(20000);
            expect(lockedQuote.discountAmount).toBe(20000n);
        });

        it('Chấp nhận coupon đúng thời điểm startsAt nhưng từ chối đúng thời điểm endsAt', async () => {
            const startsNowCoupon = {
                ...validCoupon,
                startsAt: fixedNow,
            };
            repositoryMock.findByCode.mockResolvedValue(startsNowCoupon);
            repositoryMock.countRedemptions.mockResolvedValue(0);
            repositoryMock.countTotalRedemptions.mockResolvedValue(0);

            await expect(
                service.validateCoupon('WELCOME10', 100000, 'u-1', fixedNow),
            ).resolves.toEqual({ code: 'WELCOME10', discountAmount: 10000 });

            repositoryMock.findByCode.mockResolvedValue({
                ...validCoupon,
                endsAt: fixedNow,
            });

            await expect(
                service.validateCoupon('WELCOME10', 100000, 'u-1', fixedNow),
            ).rejects.toThrow(UnprocessableEntityException);
        });

    });

    describe('quoteAndLock (UC-06 Transaction)', () => {
        it('Nên gọi lockCoupon, kiểm tra điều kiện và trả về CouponQuoteEntity', async () => {
        const txMock = {} as any;
        repositoryMock.lockCoupon.mockResolvedValue(validCoupon);
        repositoryMock.countRedemptions.mockResolvedValue(0);
        repositoryMock.countTotalRedemptions.mockResolvedValue(0);

        const result = await service.quoteAndLock(txMock, 'u-1', 'WELCOME10', 100000n, fixedNow);

        expect(repositoryMock.lockCoupon).toHaveBeenCalledWith('WELCOME10', txMock);
        expect(result).toEqual({
            couponId: 'c-1',
            code: 'WELCOME10',
            discountType: 'PERCENTAGE',
            discountAmount: 10000n,
            userId: 'u-1',
        });
        });

        it('Nên ném COUPON_NOT_APPLICABLE nếu bị khóa dòng trả về null', async () => {
        const txMock = {} as any;
        repositoryMock.lockCoupon.mockResolvedValue(null);

        await expect(service.quoteAndLock(txMock, 'u-1', 'NOT_FOUND', 100000n, fixedNow))
            .rejects.toThrow(UnprocessableEntityException);
        });
    });

    describe('reserve (UC-06 Transaction)', () => {
        it('Nên gọi createRedemption với đúng tx và dữ liệu', async () => {
        const txMock = {} as any;
        const quote = {
            couponId: 'c-1',
            code: 'WELCOME10',
            discountType: 'PERCENTAGE' as DiscountType,
            discountAmount: 15000n,
            userId: 'u-1',
        };
        const expiresAt = new Date('2026-10-22T08:15:00.000Z');
        repositoryMock.createRedemption.mockResolvedValue({ id: 'r-1' });

        await service.reserve(txMock, quote, 'o-1', expiresAt);

        expect(repositoryMock.createRedemption).toHaveBeenCalledWith({
            couponId: 'c-1',
            userId: 'u-1',
            orderId: 'o-1',
            discountAmount: 15000n,
            expiresAt,
        }, txMock);
        });
    });

/*
*Bổ sung Mock và Test Cases cho consumeRedemption & releaseRedemption trong promotions.service.spec.ts
→ Tại sao làm bước này trước?
    Theo quy chuẩn GEMINI.md (TDD Mandatory) và ADR-001 (Module Boundary),
    OrdersModule không được phép gọi trực tiếp
        PromotionsRepository.consumeByOrderId
        hay releaseByOrderId,
    mà bắt buộc phải gọi qua public method của PromotionsService.
    → Vì vậy, ta viết bài test mô tả đúng hợp đồng của 2 hàm này tại PromotionsService trước.
*/
    describe('consumeRedemption (UC-08 Transaction)', () => {
        it('Nên gọi repository.consumeByOrderId với đúng tx và orderId', async () => {
            const txMock = {} as any;
            repositoryMock.consumeByOrderId.mockResolvedValue(1);

            await service.consumeRedemption(txMock, 'order-123');

            expect(repositoryMock.consumeByOrderId).toHaveBeenCalledWith(
                'order-123',
                expect.any(Date),
                txMock,
            );
        });
    });

    describe('releaseRedemption (UC-06 / Khách hủy đơn / CronJob)', () => {
        it('Nên gọi repository.releaseByOrderId với status EXPIRED nếu isExpired = true', async () => {
            const txMock = {} as any;
            repositoryMock.releaseByOrderId.mockResolvedValue(1);

            await service.releaseRedemption(txMock, 'order-123', true);

            expect(repositoryMock.releaseByOrderId).toHaveBeenCalledWith(
                'order-123',
                'EXPIRED',
                expect.any(Date),
                txMock,
            );
        });

        it('Nên gọi repository.releaseByOrderId với status RELEASED nếu isExpired = false', async () => {
            const txMock = {} as any;
            repositoryMock.releaseByOrderId.mockResolvedValue(1);

            await service.releaseRedemption(txMock, 'order-123', false);

            expect(repositoryMock.releaseByOrderId).toHaveBeenCalledWith(
                'order-123',
                'RELEASED',
                expect.any(Date),
                txMock,
            );
        });
    });
});