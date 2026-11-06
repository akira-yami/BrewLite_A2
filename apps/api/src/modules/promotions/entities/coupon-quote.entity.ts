import type { DiscountType } from '../../../generated/prisma/client.js';

export interface CouponQuoteEntity {
    couponId: string;
    code: string;
    discountType: DiscountType;
    discountAmount: bigint;
    userId: string;
}