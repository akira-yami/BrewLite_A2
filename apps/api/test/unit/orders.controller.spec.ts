// Kiểm tra controller lấy danh tính từ JWT và chuyển yêu cầu đơn hàng xuống service.
/**
 * Unit tests – OrdersController (HTTP layer)
 *
 * Issue: A2-5.2.1.1 / #30
 *
 * Kiểm tra HTTP contract của endpoint Orders:
 *   POST   /orders           — chỉ CUSTOMER
 *   GET    /orders/me
 *   GET    /orders/:id
 *   POST   /orders/:id/cancel
 *   PATCH  /orders/:id/status — chỉ BARISTA
 *
 * Controller được instantiate trực tiếp (không qua NestJS DI) để test
 * logic route dispatching và guard hoạt động đúng.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { OrdersController } from '../../src/modules/orders/orders.controller.js';
import { OrdersService } from '../../src/modules/orders/services/orders.service.js';
import type { JwtPayload } from '../../src/common/utils/jwt.js';

// ─────────────────────────────────────────────────
// Fixtures
// ─────────────────────────────────────────────────
const ORDER_ID = 'order-0001-0000-0000-000000000001';
const USER_ID = 'user-aaaa-0001-0000-000000000001';
const BARISTA_ID = 'barista-001-0000-0000-000000000001';
const VARIANT_ID = 'var-0001-0000-0000-000000000001';

const customerJwt: JwtPayload = { sub: USER_ID, role: 'CUSTOMER' };
const baristaJwt: JwtPayload = { sub: BARISTA_ID, role: 'BARISTA' };

const pendingOrderResult = {
  id: ORDER_ID,
  orderNumber: 'ORD-123-ABCDE',
  status: 'PENDING',
  subtotal: 100000,
  discountAmount: 0,
  total: 100000,
};

const createDto = {
  items: [{ productVariantId: VARIANT_ID, quantity: 1, toppings: [] }],
};

// ─────────────────────────────────────────────────
// Service mock factory
// ─────────────────────────────────────────────────
function makeServiceMock() {
  return {
    createOrder: vi.fn(),
    getMyOrders: vi.fn(),
    getOrderDetail: vi.fn(),
    cancelOrder: vi.fn(),
    advanceOrderStatus: vi.fn(),
  } as unknown as OrdersService;
}

// ─────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────
describe('OrdersController.create', () => {
  let controller: OrdersController;
  let service: OrdersService;

  beforeEach(() => {
    service = makeServiceMock();
    controller = new OrdersController(service);
  });

  it('TC-CTRL-ORDER-01: gọi service.createOrder với userId từ JWT và trả { success, data }', async () => {
    (service.createOrder as ReturnType<typeof vi.fn>).mockResolvedValue(pendingOrderResult);

    const result = await controller.create(customerJwt, createDto as never);

    expect(service.createOrder).toHaveBeenCalledWith(USER_ID, createDto);
    expect(result).toEqual({ success: true, data: pendingOrderResult });
  });

  it('TC-CTRL-ORDER-02: propagates ConflictException từ service', async () => {
    (service.createOrder as ReturnType<typeof vi.fn>).mockRejectedValue(
      new ConflictException('OUT_OF_STOCK'),
    );

    await expect(controller.create(customerJwt, createDto as never))
      .rejects.toBeInstanceOf(ConflictException);
  });
});

describe('OrdersController.getMyOrders', () => {
  let controller: OrdersController;
  let service: OrdersService;

  beforeEach(() => {
    service = makeServiceMock();
    controller = new OrdersController(service);
  });

  it('TC-CTRL-ORDER-03: gọi service.getMyOrders với userId từ JWT', async () => {
    (service.getMyOrders as ReturnType<typeof vi.fn>).mockResolvedValue([pendingOrderResult]);

    const result = await controller.getMyOrders(customerJwt);

    expect(service.getMyOrders).toHaveBeenCalledWith(USER_ID);
    expect(result).toEqual({ success: true, data: [pendingOrderResult] });
  });

  it('TC-CTRL-ORDER-04: trả về danh sách rỗng khi không có đơn', async () => {
    (service.getMyOrders as ReturnType<typeof vi.fn>).mockResolvedValue([]);

    const result = await controller.getMyOrders(customerJwt);

    expect(result.data).toEqual([]);
  });
});

describe('OrdersController.getOrder', () => {
  let controller: OrdersController;
  let service: OrdersService;

  beforeEach(() => {
    service = makeServiceMock();
    controller = new OrdersController(service);
  });

  it('TC-CTRL-ORDER-05: gọi service.getOrderDetail với id và userId từ JWT', async () => {
    (service.getOrderDetail as ReturnType<typeof vi.fn>).mockResolvedValue(pendingOrderResult);

    const result = await controller.getOrder(ORDER_ID, customerJwt);

    expect(service.getOrderDetail).toHaveBeenCalledWith(ORDER_ID, USER_ID);
    expect(result).toEqual({ success: true, data: pendingOrderResult });
  });

  it('TC-CTRL-ORDER-06: propagates NotFoundException từ service', async () => {
    (service.getOrderDetail as ReturnType<typeof vi.fn>).mockRejectedValue(
      new NotFoundException('Order not found'),
    );

    await expect(controller.getOrder(ORDER_ID, customerJwt))
      .rejects.toBeInstanceOf(NotFoundException);
  });

  it('TC-CTRL-ORDER-07: propagates ForbiddenException khi user B cố đọc đơn A', async () => {
    (service.getOrderDetail as ReturnType<typeof vi.fn>).mockRejectedValue(
      new ForbiddenException('Access denied'),
    );

    await expect(controller.getOrder(ORDER_ID, customerJwt))
      .rejects.toBeInstanceOf(ForbiddenException);
  });
});

describe('OrdersController.cancel', () => {
  let controller: OrdersController;
  let service: OrdersService;

  beforeEach(() => {
    service = makeServiceMock();
    controller = new OrdersController(service);
  });

  it('TC-CTRL-ORDER-08: gọi service.cancelOrder với id và userId từ JWT', async () => {
    (service.getOrderDetail as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: ORDER_ID,
      status: 'CANCELLED',
    });

    const result = await controller.cancel(ORDER_ID, customerJwt);

    expect(service.cancelOrder).toHaveBeenCalledWith(ORDER_ID, USER_ID, 'Khách hàng yêu cầu hủy đơn hàng', false);
    expect(service.getOrderDetail).toHaveBeenCalledWith(ORDER_ID, USER_ID);
    expect(result).toEqual({ success: true, data: { id: ORDER_ID, status: 'CANCELLED' } });
  });

  it('TC-CTRL-ORDER-09: propagates ConflictException ORDER_INVALID_TRANSITION', async () => {
    (service.cancelOrder as ReturnType<typeof vi.fn>).mockRejectedValue(
      new ConflictException('ORDER_INVALID_TRANSITION'),
    );

    await expect(controller.cancel(ORDER_ID, customerJwt))
      .rejects.toBeInstanceOf(ConflictException);
  });

  it('TC-CTRL-ORDER-10: propagates ConflictException PAYMENT_IN_PROGRESS', async () => {
    (service.cancelOrder as ReturnType<typeof vi.fn>).mockRejectedValue(
      new ConflictException('PAYMENT_IN_PROGRESS'),
    );

    await expect(controller.cancel(ORDER_ID, customerJwt))
      .rejects.toBeInstanceOf(ConflictException);
  });
});

describe('OrdersController.updateStatus', () => {
  let controller: OrdersController;
  let service: OrdersService;

  beforeEach(() => {
    service = makeServiceMock();
    controller = new OrdersController(service);
  });

  it('TC-CTRL-ORDER-11: BARISTA gọi service.advanceOrderStatus với id, status và actorId', async () => {
    (service.advanceOrderStatus as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: ORDER_ID,
      status: 'PREPARING',
    });

    const result = await controller.updateStatus(
      ORDER_ID,
      { status: 'PREPARING' },
      baristaJwt,
    );

    expect(service.advanceOrderStatus).toHaveBeenCalledWith(ORDER_ID, BARISTA_ID, 'PREPARING');
    expect(result).toEqual({ success: true, data: { id: ORDER_ID, status: 'PREPARING' } });
  });

  it('TC-CTRL-ORDER-12: propagates ConflictException ORDER_INVALID_TRANSITION từ service', async () => {
    (service.advanceOrderStatus as ReturnType<typeof vi.fn>).mockRejectedValue(
      new ConflictException('ORDER_INVALID_TRANSITION'),
    );

    await expect(controller.updateStatus(ORDER_ID, { status: 'PREPARING' }, baristaJwt))
      .rejects.toBeInstanceOf(ConflictException);
  });

  it('TC-CTRL-ORDER-13: propagates NotFoundException khi đơn không tồn tại', async () => {
    (service.advanceOrderStatus as ReturnType<typeof vi.fn>).mockRejectedValue(
      new NotFoundException('Order not found'),
    );

    await expect(controller.updateStatus(ORDER_ID, { status: 'PREPARING' }, baristaJwt))
      .rejects.toBeInstanceOf(NotFoundException);
  });
});
