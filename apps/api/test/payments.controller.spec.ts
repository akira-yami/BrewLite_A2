/**
 * Unit tests – PaymentsController (HTTP layer)
 *
 * Issue: A2-5.2.1.2 / #31
 * Phụ trách: Kiệt · Sprint 2
 *
 * Phạm vi bao phủ (SRS FR-07, AT-FR-07.1):
 *   POST /api/v1/payments
 *
 *   TC-CTRL-PAY-01  Thiếu Idempotency-Key → 400 BadRequestException
 *   TC-CTRL-PAY-02  Idempotency-Key rỗng (chỉ khoảng trắng) → 400
 *   TC-CTRL-PAY-03  Idempotency-Key quá dài (> 100 ký tự) → 400
 *   TC-CTRL-PAY-04  Thanh toán thành công → { success: true, data: { status: 'SUCCEEDED' } }
 *   TC-CTRL-PAY-05  Thanh toán thất bại DECLINE → { success: true, data: { status: 'FAILED' } }
 *   TC-CTRL-PAY-06  GATEWAY_TIMEOUT → propagates ServiceUnavailableException
 *   TC-CTRL-PAY-07  PAYMENT_IN_PROGRESS → propagates ConflictException
 *   TC-CTRL-PAY-08  IDEMPOTENCY_KEY_REUSED → propagates ConflictException
 *   TC-CTRL-PAY-09  ORDER_ALREADY_PAID → propagates ConflictException
 *   TC-CTRL-PAY-10  NotFoundException khi đơn không tồn tại → propagates
 *   TC-CTRL-PAY-11  ForbiddenException khi sai chủ đơn → propagates
 *   TC-CTRL-PAY-12  Gọi service.pay với đúng userId từ JWT và idempotencyKey từ header
 *
 * Controller được instantiate trực tiếp (không qua NestJS DI) để test
 * logic route dispatching, không cần DB.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { PaymentsController } from '../src/modules/payments/payments.controller.js';
import { PaymentsService } from '../src/modules/payments/payments.service.js';
import type { JwtPayload } from '../src/common/utils/jwt.js';

// ─────────────────────────────────────────────────
// Fixtures
// ─────────────────────────────────────────────────
const ORDER_ID = 'order-0001-0000-0000-000000000001';
const USER_ID = 'user-aaaa-0001-0000-000000000001';
const IDEM_KEY = 'idempotency-key-test-001';

const customerJwt: JwtPayload = { sub: USER_ID, role: 'CUSTOMER' };

const validDto = {
  orderId: ORDER_ID,
  method: 'E_WALLET' as const,
};

// ─────────────────────────────────────────────────
// Service mock factory
// ─────────────────────────────────────────────────
function makeServiceMock() {
  return {
    pay: vi.fn(),
  } as unknown as PaymentsService;
}

// ─────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────

describe('PaymentsController.pay — Header validation (AT-FR-07.1)', () => {
  let controller: PaymentsController;
  let service: PaymentsService;

  beforeEach(() => {
    service = makeServiceMock();
    controller = new PaymentsController(service);
  });

  // TC-CTRL-PAY-01
  it('TC-CTRL-PAY-01: thiếu Idempotency-Key header → BadRequestException 400', async () => {
    await expect(controller.pay(customerJwt, undefined, validDto as never))
      .rejects.toBeInstanceOf(BadRequestException);
  });

  // TC-CTRL-PAY-02
  it('TC-CTRL-PAY-02: Idempotency-Key là chuỗi rỗng/chỉ khoảng trắng → BadRequestException 400', async () => {
    await expect(controller.pay(customerJwt, '   ', validDto as never))
      .rejects.toBeInstanceOf(BadRequestException);
  });

  // TC-CTRL-PAY-02b
  it('TC-CTRL-PAY-02b: Idempotency-Key là empty string → BadRequestException 400', async () => {
    await expect(controller.pay(customerJwt, '', validDto as never))
      .rejects.toBeInstanceOf(BadRequestException);
  });

  // TC-CTRL-PAY-03
  it('TC-CTRL-PAY-03: Idempotency-Key dài hơn 100 ký tự → BadRequestException 400', async () => {
    const tooLongKey = 'x'.repeat(101);
    await expect(controller.pay(customerJwt, tooLongKey, validDto as never))
      .rejects.toBeInstanceOf(BadRequestException);
  });

  // TC-CTRL-PAY-03b — đúng 100 ký tự thì được chấp nhận
  it('TC-CTRL-PAY-03b: Idempotency-Key đúng 100 ký tự → được chấp nhận, gọi service', async () => {
    const exactKey = 'k'.repeat(100);
    (service.pay as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: 'pay-1',
      status: 'SUCCEEDED',
      orderId: ORDER_ID,
    });

    const result = await controller.pay(customerJwt, exactKey, validDto as never);
    expect(result.success).toBe(true);
    expect(service.pay).toHaveBeenCalledWith(USER_ID, ORDER_ID, 'E_WALLET', exactKey);
  });
});

describe('PaymentsController.pay — Happy path (AT-FR-07.2)', () => {
  let controller: PaymentsController;
  let service: PaymentsService;

  beforeEach(() => {
    service = makeServiceMock();
    controller = new PaymentsController(service);
  });

  // TC-CTRL-PAY-04
  it('TC-CTRL-PAY-04: thanh toán thành công → trả { success: true, data: { status: SUCCEEDED } }', async () => {
    const serviceResult = { id: 'pay-1', status: 'SUCCEEDED', orderId: ORDER_ID };
    (service.pay as ReturnType<typeof vi.fn>).mockResolvedValue(serviceResult);

    const result = await controller.pay(customerJwt, IDEM_KEY, validDto as never);

    expect(result).toEqual({ success: true, data: serviceResult });
    expect(service.pay).toHaveBeenCalledWith(USER_ID, ORDER_ID, 'E_WALLET', IDEM_KEY);
  });

  // TC-CTRL-PAY-05
  it('TC-CTRL-PAY-05: gateway DECLINE → { success: true, data: { status: FAILED } }', async () => {
    const serviceResult = { id: 'pay-2', status: 'FAILED', orderId: ORDER_ID };
    (service.pay as ReturnType<typeof vi.fn>).mockResolvedValue(serviceResult);

    const result = await controller.pay(customerJwt, IDEM_KEY, validDto as never);

    expect(result.success).toBe(true);
    expect(result.data.status).toBe('FAILED');
  });

  // TC-CTRL-PAY-12
  it('TC-CTRL-PAY-12: gọi service.pay với đúng (userId, orderId, method, idempotencyKey)', async () => {
    (service.pay as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: 'pay-1', status: 'SUCCEEDED', orderId: ORDER_ID,
    });

    const cardDto = { orderId: ORDER_ID, method: 'CARD' as const };
    const cardKey = 'card-key-unique-001';

    await controller.pay(customerJwt, cardKey, cardDto as never);

    expect(service.pay).toHaveBeenCalledWith(USER_ID, ORDER_ID, 'CARD', cardKey);
  });
});

describe('PaymentsController.pay — Error propagation', () => {
  let controller: PaymentsController;
  let service: PaymentsService;

  beforeEach(() => {
    service = makeServiceMock();
    controller = new PaymentsController(service);
  });

  // TC-CTRL-PAY-06
  it('TC-CTRL-PAY-06: GATEWAY_TIMEOUT → propagates ServiceUnavailableException', async () => {
    (service.pay as ReturnType<typeof vi.fn>).mockRejectedValue(
      new ServiceUnavailableException('GATEWAY_TIMEOUT'),
    );

    await expect(controller.pay(customerJwt, IDEM_KEY, validDto as never))
      .rejects.toBeInstanceOf(ServiceUnavailableException);
  });

  // TC-CTRL-PAY-07
  it('TC-CTRL-PAY-07: PAYMENT_IN_PROGRESS → propagates ConflictException', async () => {
    (service.pay as ReturnType<typeof vi.fn>).mockRejectedValue(
      new ConflictException('PAYMENT_IN_PROGRESS'),
    );

    await expect(controller.pay(customerJwt, IDEM_KEY, validDto as never))
      .rejects.toBeInstanceOf(ConflictException);
  });

  // TC-CTRL-PAY-08
  it('TC-CTRL-PAY-08: IDEMPOTENCY_KEY_REUSED → propagates ConflictException', async () => {
    (service.pay as ReturnType<typeof vi.fn>).mockRejectedValue(
      new ConflictException('IDEMPOTENCY_KEY_REUSED'),
    );

    await expect(controller.pay(customerJwt, IDEM_KEY, validDto as never))
      .rejects.toBeInstanceOf(ConflictException);
  });

  // TC-CTRL-PAY-09
  it('TC-CTRL-PAY-09: ORDER_ALREADY_PAID → propagates ConflictException', async () => {
    (service.pay as ReturnType<typeof vi.fn>).mockRejectedValue(
      new ConflictException('ORDER_ALREADY_PAID'),
    );

    await expect(controller.pay(customerJwt, IDEM_KEY, validDto as never))
      .rejects.toBeInstanceOf(ConflictException);
  });

  // TC-CTRL-PAY-10
  it('TC-CTRL-PAY-10: đơn không tồn tại → propagates NotFoundException', async () => {
    (service.pay as ReturnType<typeof vi.fn>).mockRejectedValue(
      new NotFoundException('Order not found'),
    );

    await expect(controller.pay(customerJwt, IDEM_KEY, validDto as never))
      .rejects.toBeInstanceOf(NotFoundException);
  });

  // TC-CTRL-PAY-11
  it('TC-CTRL-PAY-11: sai chủ đơn → propagates ForbiddenException', async () => {
    (service.pay as ReturnType<typeof vi.fn>).mockRejectedValue(
      new ForbiddenException('Access denied'),
    );

    await expect(controller.pay(customerJwt, IDEM_KEY, validDto as never))
      .rejects.toBeInstanceOf(ForbiddenException);
  });
});
