import { BadRequestException, Injectable, UnprocessableEntityException } from '@nestjs/common';
import { PromotionsRepository } from '../repositories/promotions.repository.js';
import type { Coupon, Prisma } from '../../../generated/prisma/client.js';
import type { CouponQuoteResponseDto } from '../dto/coupon-quote-response.dto.js';
import { toCouponQuoteResponse } from '../mappers/coupon.mapper.js';
import type { CouponQuoteEntity } from '../entities/coupon-quote.entity.js';
import { DefaultArgs } from '@prisma/client/runtime/client';
import { PrismaClient } from '../../../generated/prisma/internal/class.js';

@Injectable()
export class PromotionsService {
    releaseByOrderId(_orderId: string, _arg1: string, _arg2: Date, _tx: Omit<PrismaClient<never, Prisma.GlobalOmitConfig | undefined, DefaultArgs>, "$connect" | "$disconnect" | "$on" | "$use" | "$extends">) {
      throw new Error('Method not implemented.');
    }
    constructor(private readonly repository: PromotionsRepository) {}

    // Dùng chung bộ quy tắc để Preview và tạo Order không lệch điều kiện coupon.
    private assertCouponApplicable(
        coupon: Coupon | null,
        subtotal: bigint,
        now: Date,
    ): asserts coupon is Coupon {
        if (!coupon || !coupon.isActive) {
            throw new UnprocessableEntityException({
                error: {
                    code: 'COUPON_NOT_APPLICABLE',
                    message: 'Mã giảm giá không tồn tại hoặc đã ngừng hoạt động.',
                },
            });
        }

        // startsAt được tính bao gồm; endsAt là mốc loại trừ.
        if (now < coupon.startsAt || now >= coupon.endsAt) {
            throw new UnprocessableEntityException({
                error: {
                    code: 'COUPON_NOT_APPLICABLE',
                    message: 'Mã giảm giá không trong thời gian có hiệu lực.',
                },
            });
        }

        if (subtotal < coupon.minOrderValue) {
            throw new UnprocessableEntityException({
                error: {
                    code: 'COUPON_NOT_APPLICABLE',
                    message: 'Đơn hàng chưa đạt giá trị tối thiểu để áp dụng mã.',
                },
            });
        }
    }

    // Tính tiền bằng BigInt để tránh sai số số thực; phần trăm được làm tròn xuống theo VND.
    private calculateDiscountAmount(coupon: Coupon, subtotal: bigint): bigint {
        if (coupon.discountType === 'PERCENTAGE') {
            const percentageAmount = (subtotal * coupon.discountValue) / 100n;
            return coupon.maxDiscount !== null && percentageAmount > coupon.maxDiscount
                ? coupon.maxDiscount
                : percentageAmount;
        }

        return subtotal < coupon.discountValue ? subtotal : coupon.discountValue;
    }

    async validateCoupon(
        code: string,
        subtotal: number,
        userId: string,
        now: Date,
    ): Promise<CouponQuoteResponseDto> {
        // Preview nhận subtotal dạng JSON number nên phải chặn số không an toàn trước khi đổi sang BigInt.
        if (!Number.isSafeInteger(subtotal) || subtotal < 0) {
            throw new BadRequestException({
                error: {
                    code: 'VALIDATION_ERROR',
                    message: 'Subtotal phải là số nguyên không âm trong giới hạn an toàn.',
                },
            });
        }

        const subtotalBigInt = BigInt(subtotal);
        const coupon = await this.repository.findByCode(code);
        this.assertCouponApplicable(coupon, subtotalBigInt, now);

        const userRedemptions = await this.repository.countRedemptions(
            coupon.id,
            userId,
            now,
        );
        if (userRedemptions >= coupon.perUserLimit) {
            throw new UnprocessableEntityException({
                error: {
                    code: 'COUPON_NOT_APPLICABLE',
                    message: 'Bạn đã hết lượt sử dụng mã giảm giá này.',
                },
            });
        }

        if (coupon.usageLimit !== null) {
            const totalRedemptions = await this.repository.countTotalRedemptions(
                coupon.id,
                now,
            );
            if (totalRedemptions >= coupon.usageLimit) {
                throw new UnprocessableEntityException({
                    error: {
                        code: 'COUPON_NOT_APPLICABLE',
                        message: 'Mã giảm giá đã hết lượt sử dụng trên toàn hệ thống.',
                    },
                });
            }
        }

        return toCouponQuoteResponse(
            coupon.code,
            this.calculateDiscountAmount(coupon, subtotalBigInt),
        );
    }

    async quoteAndLock(
        tx: Prisma.TransactionClient,
        userId: string,
        code: string,
        subtotal: bigint,
        now: Date,
    ): Promise<CouponQuoteEntity> {
        const coupon = await this.repository.lockCoupon(code, tx);
        this.assertCouponApplicable(coupon, subtotal, now);

        const userRedemptions = await this.repository.countRedemptions(
            coupon.id,
            userId,
            now,
            tx,
        );
        if (userRedemptions >= coupon.perUserLimit) {
            throw new UnprocessableEntityException({
                error: {
                    code: 'COUPON_NOT_APPLICABLE',
                    message: 'Bạn đã hết lượt sử dụng mã giảm giá này.',
                },
            });
        }

        if (coupon.usageLimit !== null) {
            const totalRedemptions = await this.repository.countTotalRedemptions(
                coupon.id,
                now,
                tx,
            );
            if (totalRedemptions >= coupon.usageLimit) {
                throw new UnprocessableEntityException({
                    error: {
                        code: 'COUPON_NOT_APPLICABLE',
                        message: 'Mã giảm giá đã hết lượt sử dụng trên toàn hệ thống.',
                    },
                });
            }
        }

        return {
            couponId: coupon.id,
            code: coupon.code,
            discountType: coupon.discountType,
            discountAmount: this.calculateDiscountAmount(coupon, subtotal),
            userId,
        };
    }

    async reserve(
        tx: Prisma.TransactionClient,
        quote: CouponQuoteEntity,
        orderId: string,
        expiresAt: Date,
    ) {
        return this.repository.createRedemption(
        {
            couponId: quote.couponId,
            userId: quote.userId,
            orderId,
            discountAmount: quote.discountAmount,
            expiresAt,
        },
        tx,
        );
    }

/*
*Rà soát consumeRedemption & releaseRedemption trong promotions.service.ts và chạy test promotions.repository.spec.ts
→ Tại sao cần kiểm tra bước này?
    Ở tầng PromotionsRepository, hai hàm consumeByOrderId và releaseByOrderId sử dụng điều kiện where: { orderId, status: 'RESERVED' }.
    Điều này cực kỳ quan trọng vì nó đảm bảo tính Idempotent cho vòng đời Coupon:
        - chỉ những lượt đang RESERVED mới được chuyển sang CONSUMED (khi PAID)
        - hoặc RELEASED/EXPIRED (khi hủy/hết hạn), ngăn chặn tuyệt đối việc tiêu thụ hoặc giải phóng mã lặp lại.
*/

    async consumeRedemption(tx: Prisma.TransactionClient, orderId: string): Promise<void> {await this.repository.consumeByOrderId(orderId, new Date(), tx);}

    async releaseRedemption(
        tx: Prisma.TransactionClient,
        orderId: string,
        isExpired: boolean,
    ): Promise<void> {
        const targetStatus = isExpired ? 'EXPIRED' : 'RELEASED';
        await this.repository.releaseByOrderId(orderId, targetStatus, new Date(), tx);
    }
}
