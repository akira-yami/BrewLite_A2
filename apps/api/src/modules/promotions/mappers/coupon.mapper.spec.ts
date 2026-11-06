import { describe, it, expect } from 'vitest';
import { toCouponQuoteResponse } from './coupon.mapper.js';

describe('CouponMapper (Unit Test - TDD)', () => {
    it('toCouponQuoteResponse - nên chuyển đổi BigInt thành number và map đúng DTO', () => {
        const code = 'WELCOME10';
        const discountAmount = 25000n;

        const result = toCouponQuoteResponse(code, discountAmount);

        expect(result).toEqual({
        code: 'WELCOME10',
        discountAmount: 25000,
        });
        expect(typeof result.discountAmount).toBe('number');
    });

    it('toCouponQuoteResponse - nên ném RangeError khi discountAmount âm', () => {
        expect(() => toCouponQuoteResponse('WELCOME10', -100n)).toThrow(RangeError);
    });

    it('toCouponQuoteResponse - nên ném RangeError khi discountAmount vượt MAX_SAFE_INTEGER', () => {
        const unsafeValue = BigInt(Number.MAX_SAFE_INTEGER) + 1n;
        expect(() => toCouponQuoteResponse('WELCOME10', unsafeValue)).toThrow(RangeError);
    });
});