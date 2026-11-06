import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PromotionsController } from './promotions.controller.js';
import { PromotionsService } from '../services/promotions.service.js';

describe('PromotionsController (Unit Test)', () => {
    let controller: PromotionsController;
    let serviceMock: any;

    beforeEach(() => {
        serviceMock = {validateCoupon: vi.fn(),};
        controller = new PromotionsController(serviceMock as unknown as PromotionsService);
    });

    it('validate - nên gọi PromotionsService.validateCoupon và trả về data bọc trong envelope', async () => {
        const mockUser = { sub: 'u-1', username: 'testuser', role: 'CUSTOMER' };
        const mockDto = { code: 'WELCOME10', subtotal: 100000 };
        const mockResponse = { code: 'WELCOME10', discountAmount: 10000 };

        serviceMock.validateCoupon.mockResolvedValue(mockResponse);

        // Mock Date.now() / getTime() thông qua việc service sẽ nhận một đối tượng Date
        const result = await controller.validate(mockDto, mockUser);

        expect(serviceMock.validateCoupon).toHaveBeenCalledWith(
            'WELCOME10',
            100000,
            'u-1',
            expect.any(Date),
        );
        expect(result).toEqual({ data: mockResponse });
    });
});