import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { ValidateCouponDto } from './validate-coupon.dto.js';
import { describe, it, expect } from 'vitest';

describe('ValidateCouponDto (Unit Test - TDD)', () => {
    it('Nên PASS khi gửi mã coupon và subtotal hợp lệ', async () => {
        const dto = plainToInstance(ValidateCouponDto, {
        code: 'WELCOME10',
        subtotal: 150000,
        });
        const errors = await validate(dto);
        expect(errors.length).toBe(0);
    });

    it('Nên FAIL khi bỏ trống mã code', async () => {
        const dto = plainToInstance(ValidateCouponDto, { subtotal: 150000 });
        const errors = await validate(dto);
        expect(errors.length).toBeGreaterThan(0);
        expect(errors[0].property).toBe('code');
    });

    it('Nên FAIL khi mã code vượt quá 50 ký tự', async () => {
        const dto = plainToInstance(ValidateCouponDto, {
        code: 'A'.repeat(51),
        subtotal: 150000,
        });
        const errors = await validate(dto);
        expect(errors.length).toBeGreaterThan(0);
        expect(errors[0].property).toBe('code');
    });

    it('Nên FAIL khi subtotal vượt Number.MAX_SAFE_INTEGER', async () => {
        const dto = plainToInstance(ValidateCouponDto, {
            code: 'WELCOME10',
            subtotal: Number.MAX_SAFE_INTEGER + 1,
        });
        const errors = await validate(dto);

        expect(errors.some((error) => error.property === 'subtotal')).toBe(true);
    });

    it('Nên FAIL khi subtotal không phải là số dương', async () => {
        const dto = plainToInstance(ValidateCouponDto, {
        code: 'WELCOME10',
        subtotal: -50000,
        });
        const errors = await validate(dto);
        expect(errors.length).toBeGreaterThan(0);
        expect(errors[0].property).toBe('subtotal');
    });
});