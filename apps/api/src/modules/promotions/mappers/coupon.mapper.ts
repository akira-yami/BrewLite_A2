import type { CouponQuoteResponseDto } from '../dto/coupon-quote-response.dto.js';

export function toCouponQuoteResponse(
    code: string,
    discountAmount: bigint,
    ): CouponQuoteResponseDto {
    const numericDiscount = Number(discountAmount);
    if (!Number.isSafeInteger(numericDiscount) || numericDiscount < 0) {
        throw new RangeError('Discount amount is outside safe integer range');
    }

    return {
        code,
        discountAmount: numericDiscount,
    };
}