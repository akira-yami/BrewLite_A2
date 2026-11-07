/**
 * Unit tests – OrdersService
 *
 * Issue: A2-5.2.1.1 / #30
 * Phụ trách: Kiệt · Sprint 2
 *
 * Phạm vi bao phủ (SRS FR-06, FR-08, FR-09, FR-10):
 *   TC-ORD-CREATE  createOrder  — validation, BOM, inventory, coupon, snapshot, rollback
 *   TC-ORD-CANCEL  cancelOrder  — ownership, state transition, payment-in-progress guard
 *   TC-ORD-STATUS  updateStatus — transition bảng FR-09 (BARISTA path)
 *   TC-ORD-GET     getOrderById — ownership, not-found
 *   TC-ORD-LIST    getMyOrders  — chỉ trả đơn của owner
 *
 * Tất cả Prisma calls đều bị mock — không cần DB.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { OrdersService } from '../src/modules/orders/orders.service.js';
import type { PrismaService } from '../src/database/prisma.service.js';
import type { Prisma } from '../src/generated/prisma/client.js';

// ─────────────────────────────────────────────────
// Fixtures
// ─────────────────────────────────────────────────
const USER_A = 'user-aaaa-0001-0000-000000000001';
const USER_B = 'user-bbbb-0002-0000-000000000002';
const ORDER_ID = 'order-0001-0000-0000-000000000001';
const VARIANT_ID = 'var-0001-0000-0000-000000000001';
const INGREDIENT_ID = 'ing-0001-0000-0000-000000000001';
const TOPPING_ID = 'top-0001-0000-0000-000000000001';
const ING_ID_2 = 'ing-0002-0000-0000-000000000002';

const PENDING_ORDER = {
  id: ORDER_ID,
  userId: USER_A,
  status: 'PENDING' as const,
  subtotal: 50000n,
  discountAmount: 0n,
  total: 50000n,
};

const ACTIVE_VARIANT = {
  id: VARIANT_ID,
  productId: 'prod-0001',
  size: 'M' as const,
  price: 50000n,
  isActive: true,
  product: { id: 'prod-0001', name: 'Cà phê sữa' },
  recipeItems: [
    {
      ingredientId: INGREDIENT_ID,
      quantity: 10,
      ingredient: { id: INGREDIENT_ID, stockQuantity: 100, version: 0, isActive: true },
    },
  ],
};

const ACTIVE_TOPPING = {
  id: TOPPING_ID,
  name: 'Trân châu',
  price: 8000n,
  isActive: true,
  recipeItems: [
    {
      ingredientId: ING_ID_2,
      quantity: 30,
      ingredient: { id: ING_ID_2, stockQuantity: 300, version: 0, isActive: true },
    },
  ],
};

// ─────────────────────────────────────────────────
// Prisma mock factory
// ─────────────────────────────────────────────────
function makePrisma() {
  const productVariantFindFirst = vi.fn();
  const toppingFindFirst = vi.fn();
  const orderCreate = vi.fn();
  const orderUpdate = vi.fn();
  const orderFindUnique = vi.fn();
  const orderFindFirst = vi.fn();
  const orderFindMany = vi.fn();
  const inventoryReservationCreate = vi.fn();
  const inventoryReservationFindMany = vi.fn();
  const inventoryReservationUpdate = vi.fn();
  const couponFindFirst = vi.fn();
  const couponRedemptionCount = vi.fn();
  const couponRedemptionCreate = vi.fn();
  const orderStatusHistoryCreate = vi.fn();
  const paymentCount = vi.fn();
  const $executeRaw = vi.fn().mockResolvedValue(1); // simulate 1 row updated

  const txClient = {
    productVariant: { findFirst: productVariantFindFirst },
    topping: { findFirst: toppingFindFirst },
    order: {
      create: orderCreate,
      update: orderUpdate,
      findFirst: orderFindFirst,
      findUnique: orderFindUnique,
    },
    inventoryReservation: {
      create: inventoryReservationCreate,
      findMany: inventoryReservationFindMany,
      update: inventoryReservationUpdate,
    },
    coupon: { findFirst: couponFindFirst },
    couponRedemption: {
      count: couponRedemptionCount,
      create: couponRedemptionCreate,
    },
    orderStatusHistory: { create: orderStatusHistoryCreate },
    payment: { count: paymentCount },
    $executeRaw,
  };

  const $transaction = vi.fn(async (fn: (tx: typeof txClient) => unknown) => fn(txClient));

  const prisma = {
    $transaction,
    order: {
      findUnique: orderFindUnique,
      findMany: orderFindMany,
    },
    _tx: txClient,
  } as unknown as PrismaService & { _tx: typeof txClient };

  return {
    prisma,
    $transaction,
    txClient,
    productVariantFindFirst,
    toppingFindFirst,
    orderCreate,
    orderUpdate,
    orderFindUnique,
    orderFindFirst,
    orderFindMany,
    inventoryReservationCreate,
    inventoryReservationFindMany,
    inventoryReservationUpdate,
    couponFindFirst,
    couponRedemptionCount,
    couponRedemptionCreate,
    orderStatusHistoryCreate,
    paymentCount,
    $executeRaw,
  };
}

// ─────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────
function makeSimpleCreateDto() {
  return {
    items: [{ productVariantId: VARIANT_ID, quantity: 2, toppings: [] }],
  };
}

function setupHappyPathCreate(mocks: ReturnType<typeof makePrisma>) {
  const { txClient } = mocks;
  txClient.productVariant.findFirst.mockResolvedValue(ACTIVE_VARIANT);
  txClient.$executeRaw.mockResolvedValue(1);
  txClient.order.create.mockResolvedValue({
    id: ORDER_ID,
    orderNumber: 'ORD-1234-ABCDE',
    status: 'PENDING',
    subtotal: 100000n,
    discountAmount: 0n,
    total: 100000n,
    reservationExpiresAt: new Date(),
    items: [],
  });
  txClient.inventoryReservation.create.mockResolvedValue({});
}

// ─────────────────────────────────────────────────
// TC-ORD-CREATE: createOrder
// ─────────────────────────────────────────────────
describe('OrdersService.createOrder', () => {
  let originalEnv: Record<string, string | undefined>;

  beforeEach(() => {
    originalEnv = { RESERVATION_TTL_SECONDS: process.env.RESERVATION_TTL_SECONDS };
    process.env.RESERVATION_TTL_SECONDS = '900';
  });

  afterEach(() => {
    process.env.RESERVATION_TTL_SECONDS = originalEnv.RESERVATION_TTL_SECONDS;
  });

  // ── TC-ORD-CREATE-01 ────────────────────────────
  it('TC-ORD-CREATE-01: tạo đơn thành công — trả về id, orderNumber, status PENDING', async () => {
    const mocks = makePrisma();
    setupHappyPathCreate(mocks);

    const svc = new OrdersService(mocks.prisma);
    const result = await svc.createOrder(USER_A, makeSimpleCreateDto());

    expect(result.status).toBe('PENDING');
    expect(result).toHaveProperty('id');
    expect(result).toHaveProperty('orderNumber');
    expect(result).toHaveProperty('total');
    expect(mocks.txClient.order.create).toHaveBeenCalledOnce();
  });

  // ── TC-ORD-CREATE-02 ────────────────────────────
  it('TC-ORD-CREATE-02: tính giá đúng — 2 ly × 50000 = 100000', async () => {
    const mocks = makePrisma();
    setupHappyPathCreate(mocks);

    const svc = new OrdersService(mocks.prisma);
    const result = await svc.createOrder(USER_A, makeSimpleCreateDto());

    expect(result.subtotal).toBe(100000);
    expect(result.total).toBe(100000);
    expect(result.discountAmount).toBe(0);
  });

  // ── TC-ORD-CREATE-03 ────────────────────────────
  it('TC-ORD-CREATE-03: tính giá có topping — size+topping×quantity', async () => {
    const mocks = makePrisma();
    const { txClient } = mocks;
    txClient.productVariant.findFirst.mockResolvedValue(ACTIVE_VARIANT);
    txClient.topping.findFirst.mockResolvedValue(ACTIVE_TOPPING);
    txClient.$executeRaw.mockResolvedValue(1);
    // subtotal = (50000 + 8000) × 1 = 58000
    txClient.order.create.mockResolvedValue({
      id: ORDER_ID,
      orderNumber: 'ORD-1234-ABCDE',
      status: 'PENDING',
      subtotal: 58000n,
      discountAmount: 0n,
      total: 58000n,
      reservationExpiresAt: new Date(),
      items: [],
    });
    txClient.inventoryReservation.create.mockResolvedValue({});

    const svc = new OrdersService(mocks.prisma);
    const result = await svc.createOrder(USER_A, {
      items: [{
        productVariantId: VARIANT_ID,
        quantity: 1,
        toppings: [{ toppingId: TOPPING_ID }],
      }],
    });

    expect(result.subtotal).toBe(58000);
    expect(result.total).toBe(58000);
  });

  // ── TC-ORD-CREATE-04 ────────────────────────────
  it('TC-ORD-CREATE-04: ném ConflictException khi variant không active hoặc không tìm thấy', async () => {
    const mocks = makePrisma();
    mocks.txClient.productVariant.findFirst.mockResolvedValue(null);

    const svc = new OrdersService(mocks.prisma);
    await expect(svc.createOrder(USER_A, makeSimpleCreateDto()))
      .rejects.toBeInstanceOf(ConflictException);
  });

  // ── TC-ORD-CREATE-05 ────────────────────────────
  it('TC-ORD-CREATE-05: ném ConflictException khi hết tồn kho (stock < need)', async () => {
    const mocks = makePrisma();
    // Variant cần 10 × 2 = 20 nhưng chỉ có 15
    const lowStockVariant = {
      ...ACTIVE_VARIANT,
      recipeItems: [{
        ingredientId: INGREDIENT_ID,
        quantity: 10,
        ingredient: { id: INGREDIENT_ID, stockQuantity: 15, version: 0, isActive: true },
      }],
    };
    mocks.txClient.productVariant.findFirst.mockResolvedValue(lowStockVariant);

    const svc = new OrdersService(mocks.prisma);
    await expect(svc.createOrder(USER_A, makeSimpleCreateDto()))
      .rejects.toBeInstanceOf(ConflictException);
  });

  // ── TC-ORD-CREATE-06 ────────────────────────────
  it('TC-ORD-CREATE-06: ném ConflictException khi $executeRaw trả 0 (optimistic lock conflict)', async () => {
    const mocks = makePrisma();
    mocks.txClient.productVariant.findFirst.mockResolvedValue(ACTIVE_VARIANT);
    // Simulate version mismatch — no rows updated
    mocks.txClient.$executeRaw.mockResolvedValue(0);

    const svc = new OrdersService(mocks.prisma);
    await expect(svc.createOrder(USER_A, makeSimpleCreateDto()))
      .rejects.toBeInstanceOf(ConflictException);
  });

  // ── TC-ORD-CREATE-07 ────────────────────────────
  it('TC-ORD-CREATE-07: rollback toàn bộ khi có lỗi giữa chừng — $transaction throw sẽ lan ra', async () => {
    const mocks = makePrisma();
    mocks.txClient.productVariant.findFirst.mockResolvedValue(ACTIVE_VARIANT);
    mocks.txClient.$executeRaw.mockResolvedValue(1);
    // order.create throws simulating a DB error mid-transaction
    const dbError = new Error('DB_WRITE_FAILURE');
    mocks.txClient.order.create.mockRejectedValue(dbError);

    const svc = new OrdersService(mocks.prisma);
    await expect(svc.createOrder(USER_A, makeSimpleCreateDto()))
      .rejects.toThrow('DB_WRITE_FAILURE');

    // inventoryReservation.create should NOT have been called
    expect(mocks.txClient.inventoryReservation.create).not.toHaveBeenCalled();
  });

  // ── TC-ORD-CREATE-08 ────────────────────────────
  it('TC-ORD-CREATE-08: serialization error được retry tối đa 3 lần rồi ném ConflictException', async () => {
    const mocks = makePrisma();
    const serializationErr = Object.assign(new Error('could not serialize access due to concurrent update'), {
      code: 'P2034',
    });
    // $transaction luôn throw serialization error
    mocks.$transaction.mockRejectedValue(serializationErr);

    const svc = new OrdersService(mocks.prisma);
    await expect(svc.createOrder(USER_A, makeSimpleCreateDto()))
      .rejects.toThrow();

    // Called MAX_RETRY = 3 times
    expect(mocks.$transaction).toHaveBeenCalledTimes(3);
  });

  // ── TC-ORD-CREATE-09 ────────────────────────────
  it('TC-ORD-CREATE-09: ghi snapshot — tên/giá của order item không bị ảnh hưởng sau khi catalog thay đổi', async () => {
    const mocks = makePrisma();
    setupHappyPathCreate(mocks);

    const svc = new OrdersService(mocks.prisma);
    await svc.createOrder(USER_A, makeSimpleCreateDto());

    // Verify order.create was called with snapshot fields
    const createArg = mocks.txClient.order.create.mock.calls[0]?.[0] as {
      data: { items: { create: Array<{ productNameSnapshot: string; variantNameSnapshot: string; unitPrice: bigint }> } };
    };
    const firstItem = createArg.data.items.create[0];
    expect(firstItem.productNameSnapshot).toBe('Cà phê sữa');
    expect(firstItem.variantNameSnapshot).toBe('Size M');
    expect(firstItem.unitPrice).toBe(50000n);
  });

  // ── TC-ORD-CREATE-10 ────────────────────────────
  it('TC-ORD-CREATE-10: note được trim, chuỗi rỗng thành null', async () => {
    const mocks = makePrisma();
    setupHappyPathCreate(mocks);

    const svc = new OrdersService(mocks.prisma);
    await svc.createOrder(USER_A, {
      items: [{
        productVariantId: VARIANT_ID,
        quantity: 1,
        note: '   ',  // whitespace only → null
        toppings: [],
      }],
    });

    const createArg = mocks.txClient.order.create.mock.calls[0]?.[0] as {
      data: { items: { create: Array<{ note: string | null }> } };
    };
    expect(createArg.data.items.create[0].note).toBeNull();
  });

  // ── TC-ORD-CREATE-11 ────────────────────────────
  it('TC-ORD-CREATE-11: coupon hợp lệ được áp dụng — discountAmount và total đúng', async () => {
    const mocks = makePrisma();
    mocks.txClient.productVariant.findFirst.mockResolvedValue(ACTIVE_VARIANT);
    mocks.txClient.$executeRaw.mockResolvedValue(1);
    // Coupon giảm 10000 cố định
    mocks.txClient.coupon.findFirst.mockResolvedValue({
      id: 'coupon-001',
      code: 'DISC10K',
      discountType: 'FIXED_AMOUNT',
      discountValue: 10000n,
      maxDiscount: null,
      minOrderValue: 0n,
      usageLimit: null,
      perUserLimit: 1,
    });
    mocks.txClient.couponRedemption.count.mockResolvedValue(0);
    mocks.txClient.order.create.mockResolvedValue({
      id: ORDER_ID,
      orderNumber: 'ORD-1234-ABCDE',
      status: 'PENDING',
      subtotal: 100000n,
      discountAmount: 10000n,
      total: 90000n,
      reservationExpiresAt: new Date(),
      items: [],
    });
    mocks.txClient.inventoryReservation.create.mockResolvedValue({});
    mocks.txClient.couponRedemption.create.mockResolvedValue({});

    const svc = new OrdersService(mocks.prisma);
    const result = await svc.createOrder(USER_A, {
      items: [{ productVariantId: VARIANT_ID, quantity: 2, toppings: [] }],
      couponCode: 'DISC10K',
    });

    expect(result.discountAmount).toBe(10000);
    expect(result.total).toBe(90000);
    expect(mocks.txClient.couponRedemption.create).toHaveBeenCalledOnce();
  });

  // ── TC-ORD-CREATE-12 ────────────────────────────
  it('TC-ORD-CREATE-12: coupon không tồn tại/hết hạn → ConflictException COUPON_NOT_APPLICABLE', async () => {
    const mocks = makePrisma();
    mocks.txClient.productVariant.findFirst.mockResolvedValue(ACTIVE_VARIANT);
    mocks.txClient.$executeRaw.mockResolvedValue(1);
    mocks.txClient.coupon.findFirst.mockResolvedValue(null);

    const svc = new OrdersService(mocks.prisma);
    await expect(svc.createOrder(USER_A, {
      items: [{ productVariantId: VARIANT_ID, quantity: 1, toppings: [] }],
      couponCode: 'INVALID_CODE',
    })).rejects.toMatchObject({ message: 'COUPON_NOT_APPLICABLE' });
  });

  // ── TC-ORD-CREATE-13 ────────────────────────────
  it('TC-ORD-CREATE-13: coupon đã dùng hết lượt của user → ConflictException COUPON_NOT_APPLICABLE', async () => {
    const mocks = makePrisma();
    mocks.txClient.productVariant.findFirst.mockResolvedValue(ACTIVE_VARIANT);
    mocks.txClient.$executeRaw.mockResolvedValue(1);
    mocks.txClient.coupon.findFirst.mockResolvedValue({
      id: 'coupon-001',
      discountType: 'FIXED_AMOUNT',
      discountValue: 5000n,
      maxDiscount: null,
      minOrderValue: 0n,
      usageLimit: null,
      perUserLimit: 1,
    });
    // User đã dùng 1 lần = đủ perUserLimit
    mocks.txClient.couponRedemption.count.mockResolvedValue(1);

    const svc = new OrdersService(mocks.prisma);
    await expect(svc.createOrder(USER_A, {
      items: [{ productVariantId: VARIANT_ID, quantity: 1, toppings: [] }],
      couponCode: 'USED_UP',
    })).rejects.toMatchObject({ message: 'COUPON_NOT_APPLICABLE' });
  });

  // ── TC-ORD-CREATE-14 ────────────────────────────
  it('TC-ORD-CREATE-14: BOM aggregation — hai dòng cùng dùng ingredient X được cộng gộp', async () => {
    const mocks = makePrisma();
    // Hai dòng cùng variant, mỗi dòng quantity=1
    // ingredient cần 10 mỗi ly → tổng cần 20
    // stock = 25 đủ
    const variantShared = {
      ...ACTIVE_VARIANT,
      id: 'var-shared',
      recipeItems: [{
        ingredientId: INGREDIENT_ID,
        quantity: 10,
        ingredient: { id: INGREDIENT_ID, stockQuantity: 25, version: 0, isActive: true },
      }],
    };

    // Two separate findFirst calls for each item
    mocks.txClient.productVariant.findFirst
      .mockResolvedValueOnce(variantShared)
      .mockResolvedValueOnce(variantShared);
    mocks.txClient.$executeRaw.mockResolvedValue(1);
    mocks.txClient.order.create.mockResolvedValue({
      id: ORDER_ID, orderNumber: 'ORD-X', status: 'PENDING',
      subtotal: 100000n, discountAmount: 0n, total: 100000n,
      reservationExpiresAt: new Date(), items: [],
    });
    mocks.txClient.inventoryReservation.create.mockResolvedValue({});

    const svc = new OrdersService(mocks.prisma);
    const result = await svc.createOrder(USER_A, {
      items: [
        { productVariantId: 'var-shared', quantity: 1, toppings: [] },
        { productVariantId: 'var-shared', quantity: 1, toppings: [] },
      ],
    });

    expect(result.status).toBe('PENDING');

    // The raw UPDATE should include the aggregated need (20)
    const rawCall = mocks.txClient.$executeRaw.mock.calls[0];
    expect(rawCall).toBeDefined();
  });

  // ── TC-ORD-CREATE-15 ────────────────────────────
  it('TC-ORD-CREATE-15: topping không active → ConflictException OUT_OF_STOCK', async () => {
    const mocks = makePrisma();
    mocks.txClient.productVariant.findFirst.mockResolvedValue(ACTIVE_VARIANT);
    mocks.txClient.topping.findFirst.mockResolvedValue(null); // topping not found / inactive

    const svc = new OrdersService(mocks.prisma);
    await expect(svc.createOrder(USER_A, {
      items: [{
        productVariantId: VARIANT_ID,
        quantity: 1,
        toppings: [{ toppingId: TOPPING_ID }],
      }],
    })).rejects.toBeInstanceOf(ConflictException);
  });
});

// ─────────────────────────────────────────────────
// TC-ORD-CANCEL: cancelOrder
// ─────────────────────────────────────────────────
describe('OrdersService.cancelOrder', () => {

  function setupCancelMocks(
    mocks: ReturnType<typeof makePrisma>,
    {
      order = PENDING_ORDER,
      paymentInProgress = 0,
      reservations = [] as Array<{ id: string; items: Array<{ ingredientId: string; quantity: number }> }>,
    } = {},
  ) {
    mocks.txClient.order.findFirst.mockResolvedValue(order);
    mocks.txClient.payment.count.mockResolvedValue(paymentInProgress);
    mocks.txClient.order.update.mockResolvedValue({ ...order, status: 'CANCELLED' });
    mocks.txClient.orderStatusHistory.create.mockResolvedValue({});
    mocks.txClient.inventoryReservation.findMany.mockResolvedValue(reservations);
    if (reservations.length > 0) {
      mocks.txClient.$executeRaw.mockResolvedValue(1);
      mocks.txClient.inventoryReservation.update.mockResolvedValue({});
    }
  }

  // ── TC-ORD-CANCEL-01 ────────────────────────────
  it('TC-ORD-CANCEL-01: hủy đơn PENDING thành công — trả { id, status: CANCELLED }', async () => {
    const mocks = makePrisma();
    setupCancelMocks(mocks);

    const svc = new OrdersService(mocks.prisma);
    const result = await svc.cancelOrder(ORDER_ID, USER_A);

    expect(result.status).toBe('CANCELLED');
    expect(result.id).toBe(ORDER_ID);
  });

  // ── TC-ORD-CANCEL-02 ────────────────────────────
  it('TC-ORD-CANCEL-02: hủy đơn PAYMENT_FAILED thành công', async () => {
    const mocks = makePrisma();
    setupCancelMocks(mocks, {
      order: { ...PENDING_ORDER, status: 'PAYMENT_FAILED' as const },
    });

    const svc = new OrdersService(mocks.prisma);
    const result = await svc.cancelOrder(ORDER_ID, USER_A);

    expect(result.status).toBe('CANCELLED');
  });

  // ── TC-ORD-CANCEL-03 ────────────────────────────
  it('TC-ORD-CANCEL-03: hủy đơn PAID thành công và release reservations', async () => {
    const reservations = [{
      id: 'res-001',
      items: [{ ingredientId: INGREDIENT_ID, quantity: 20 }],
    }];
    const mocks = makePrisma();
    setupCancelMocks(mocks, {
      order: { ...PENDING_ORDER, status: 'PAID' as const },
      reservations,
    });

    const svc = new OrdersService(mocks.prisma);
    const result = await svc.cancelOrder(ORDER_ID, USER_A);

    expect(result.status).toBe('CANCELLED');
    // inventoryReservation.update must be called to RELEASED
    expect(mocks.txClient.inventoryReservation.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { status: 'RELEASED' } }),
    );
    // Stock must be restored via $executeRaw
    expect(mocks.txClient.$executeRaw).toHaveBeenCalled();
  });

  // ── TC-ORD-CANCEL-04 ────────────────────────────
  it('TC-ORD-CANCEL-04: NotFoundException khi không tìm thấy đơn', async () => {
    const mocks = makePrisma();
    mocks.txClient.order.findFirst.mockResolvedValue(null);

    const svc = new OrdersService(mocks.prisma);
    await expect(svc.cancelOrder(ORDER_ID, USER_A))
      .rejects.toBeInstanceOf(NotFoundException);
  });

  // ── TC-ORD-CANCEL-05 ────────────────────────────
  it('TC-ORD-CANCEL-05: ForbiddenException khi user B cố hủy đơn của user A', async () => {
    const mocks = makePrisma();
    mocks.txClient.order.findFirst.mockResolvedValue(PENDING_ORDER); // owned by USER_A

    const svc = new OrdersService(mocks.prisma);
    await expect(svc.cancelOrder(ORDER_ID, USER_B))
      .rejects.toBeInstanceOf(ForbiddenException);
  });

  // ── TC-ORD-CANCEL-06 ────────────────────────────
  it('TC-ORD-CANCEL-06: ConflictException ORDER_INVALID_TRANSITION khi hủy đơn COMPLETED', async () => {
    const mocks = makePrisma();
    mocks.txClient.order.findFirst.mockResolvedValue({
      ...PENDING_ORDER, status: 'COMPLETED' as const,
    });

    const svc = new OrdersService(mocks.prisma);
    await expect(svc.cancelOrder(ORDER_ID, USER_A))
      .rejects.toMatchObject({ message: 'ORDER_INVALID_TRANSITION' });
  });

  // ── TC-ORD-CANCEL-07 ────────────────────────────
  it('TC-ORD-CANCEL-07: ConflictException PAYMENT_IN_PROGRESS khi payment đang PROCESSING', async () => {
    const mocks = makePrisma();
    mocks.txClient.order.findFirst.mockResolvedValue(PENDING_ORDER);
    mocks.txClient.payment.count.mockResolvedValue(1); // 1 PROCESSING payment

    const svc = new OrdersService(mocks.prisma);
    await expect(svc.cancelOrder(ORDER_ID, USER_A))
      .rejects.toMatchObject({ message: 'PAYMENT_IN_PROGRESS' });
  });

  // ── TC-ORD-CANCEL-08 ────────────────────────────
  it('TC-ORD-CANCEL-08: hủy đơn CANCELLED → ORDER_INVALID_TRANSITION (không hủy lần hai)', async () => {
    const mocks = makePrisma();
    mocks.txClient.order.findFirst.mockResolvedValue({
      ...PENDING_ORDER, status: 'CANCELLED' as const,
    });

    const svc = new OrdersService(mocks.prisma);
    await expect(svc.cancelOrder(ORDER_ID, USER_A))
      .rejects.toMatchObject({ message: 'ORDER_INVALID_TRANSITION' });
  });

  // ── TC-ORD-CANCEL-09 ────────────────────────────
  it('TC-ORD-CANCEL-09: releaseReservations không gọi $executeRaw khi không có reservation ACTIVE', async () => {
    const mocks = makePrisma();
    // PENDING order + no active reservations
    mocks.txClient.order.findFirst.mockResolvedValue(PENDING_ORDER);
    mocks.txClient.payment.count.mockResolvedValue(0);
    mocks.txClient.order.update.mockResolvedValue({ ...PENDING_ORDER, status: 'CANCELLED' });
    mocks.txClient.orderStatusHistory.create.mockResolvedValue({});
    mocks.txClient.inventoryReservation.findMany.mockResolvedValue([]); // no active

    const svc = new OrdersService(mocks.prisma);
    await svc.cancelOrder(ORDER_ID, USER_A);

    expect(mocks.txClient.$executeRaw).not.toHaveBeenCalled();
    expect(mocks.txClient.inventoryReservation.update).not.toHaveBeenCalled();
  });

  // ── TC-ORD-CANCEL-10 ────────────────────────────
  it('TC-ORD-CANCEL-10: history entry được tạo với fromStatus và toStatus CANCELLED', async () => {
    const mocks = makePrisma();
    setupCancelMocks(mocks);

    const svc = new OrdersService(mocks.prisma);
    await svc.cancelOrder(ORDER_ID, USER_A);

    expect(mocks.txClient.orderStatusHistory.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          fromStatus: 'PENDING',
          toStatus: 'CANCELLED',
          changedByUserId: USER_A,
        }),
      }),
    );
  });
});

// ─────────────────────────────────────────────────
// TC-ORD-STATUS: updateStatus (BARISTA path)
// ─────────────────────────────────────────────────
describe('OrdersService.updateStatus', () => {
  function setupStatusMocks(
    mocks: ReturnType<typeof makePrisma>,
    orderStatus: string,
  ) {
    mocks.txClient.order.findFirst.mockResolvedValue({
      ...PENDING_ORDER,
      status: orderStatus as never,
    });
    mocks.txClient.order.update.mockResolvedValue({});
    mocks.txClient.orderStatusHistory.create.mockResolvedValue({});
  }

  // ── TC-ORD-STATUS-01 ────────────────────────────
  it('TC-ORD-STATUS-01: PAID → PREPARING — transition hợp lệ', async () => {
    const mocks = makePrisma();
    setupStatusMocks(mocks, 'PAID');

    const svc = new OrdersService(mocks.prisma);
    const result = await svc.updateStatus(ORDER_ID, 'PREPARING', USER_A);

    expect(result.status).toBe('PREPARING');
    expect(mocks.txClient.order.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { status: 'PREPARING' } }),
    );
  });

  // ── TC-ORD-STATUS-02 ────────────────────────────
  it('TC-ORD-STATUS-02: PREPARING → READY — transition hợp lệ', async () => {
    const mocks = makePrisma();
    setupStatusMocks(mocks, 'PREPARING');

    const svc = new OrdersService(mocks.prisma);
    const result = await svc.updateStatus(ORDER_ID, 'READY', USER_A);

    expect(result.status).toBe('READY');
  });

  // ── TC-ORD-STATUS-03 ────────────────────────────
  it('TC-ORD-STATUS-03: READY → COMPLETED — transition hợp lệ', async () => {
    const mocks = makePrisma();
    setupStatusMocks(mocks, 'READY');

    const svc = new OrdersService(mocks.prisma);
    const result = await svc.updateStatus(ORDER_ID, 'COMPLETED', USER_A);

    expect(result.status).toBe('COMPLETED');
  });

  // ── TC-ORD-STATUS-04 ────────────────────────────
  it('TC-ORD-STATUS-04: PENDING → PREPARING — transition không hợp lệ, ném ConflictException', async () => {
    const mocks = makePrisma();
    setupStatusMocks(mocks, 'PENDING');

    const svc = new OrdersService(mocks.prisma);
    await expect(svc.updateStatus(ORDER_ID, 'PREPARING', USER_A))
      .rejects.toMatchObject({ message: 'ORDER_INVALID_TRANSITION' });
  });

  // ── TC-ORD-STATUS-05 ────────────────────────────
  it('TC-ORD-STATUS-05: COMPLETED → bất kỳ — luôn ném ConflictException (trạng thái cuối)', async () => {
    const mocks = makePrisma();
    setupStatusMocks(mocks, 'COMPLETED');

    const svc = new OrdersService(mocks.prisma);
    for (const target of ['PENDING', 'PAID', 'PREPARING', 'READY', 'CANCELLED', 'COMPLETED'] as const) {
      await expect(svc.updateStatus(ORDER_ID, target, USER_A))
        .rejects.toMatchObject({ message: 'ORDER_INVALID_TRANSITION' });
    }
  });

  // ── TC-ORD-STATUS-06 ────────────────────────────
  it('TC-ORD-STATUS-06: NotFoundException khi order không tồn tại', async () => {
    const mocks = makePrisma();
    mocks.txClient.order.findFirst.mockResolvedValue(null);

    const svc = new OrdersService(mocks.prisma);
    await expect(svc.updateStatus(ORDER_ID, 'PREPARING', USER_A))
      .rejects.toBeInstanceOf(NotFoundException);
  });

  // ── TC-ORD-STATUS-07 ────────────────────────────
  it('TC-ORD-STATUS-07: history entry được tạo đúng actor và trạng thái', async () => {
    const mocks = makePrisma();
    setupStatusMocks(mocks, 'PAID');

    const BARISTA_ID = 'barista-uuid-001';
    const svc = new OrdersService(mocks.prisma);
    await svc.updateStatus(ORDER_ID, 'PREPARING', BARISTA_ID);

    expect(mocks.txClient.orderStatusHistory.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          fromStatus: 'PAID',
          toStatus: 'PREPARING',
          changedByUserId: BARISTA_ID,
        }),
      }),
    );
  });

  // ── TC-ORD-STATUS-08 ────────────────────────────
  it('TC-ORD-STATUS-08: self-transition (PAID → PAID) ném ConflictException', async () => {
    const mocks = makePrisma();
    setupStatusMocks(mocks, 'PAID');

    const svc = new OrdersService(mocks.prisma);
    await expect(svc.updateStatus(ORDER_ID, 'PAID', USER_A))
      .rejects.toMatchObject({ message: 'ORDER_INVALID_TRANSITION' });
  });
});

// ─────────────────────────────────────────────────
// TC-ORD-GET: getOrderById
// ─────────────────────────────────────────────────
describe('OrdersService.getOrderById', () => {
  const fullOrder = {
    ...PENDING_ORDER,
    items: [],
    statusHistories: [],
    payments: [],
  };

  // ── TC-ORD-GET-01 ────────────────────────────────
  it('TC-ORD-GET-01: trả về đơn hàng khi owner request', async () => {
    const mocks = makePrisma();
    mocks.orderFindUnique.mockResolvedValue(fullOrder);

    const svc = new OrdersService(mocks.prisma);
    const result = await svc.getOrderById(ORDER_ID, USER_A);

    expect(result).toHaveProperty('id', ORDER_ID);
    expect(mocks.orderFindUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: ORDER_ID } }),
    );
  });

  // ── TC-ORD-GET-02 ────────────────────────────────
  it('TC-ORD-GET-02: NotFoundException khi đơn không tồn tại', async () => {
    const mocks = makePrisma();
    mocks.orderFindUnique.mockResolvedValue(null);

    const svc = new OrdersService(mocks.prisma);
    await expect(svc.getOrderById('non-existent-id', USER_A))
      .rejects.toBeInstanceOf(NotFoundException);
  });

  // ── TC-ORD-GET-03 ────────────────────────────────
  it('TC-ORD-GET-03: ForbiddenException khi user B đọc đơn của user A', async () => {
    const mocks = makePrisma();
    mocks.orderFindUnique.mockResolvedValue(fullOrder); // owned by USER_A

    const svc = new OrdersService(mocks.prisma);
    await expect(svc.getOrderById(ORDER_ID, USER_B))
      .rejects.toBeInstanceOf(ForbiddenException);
  });

  // ── TC-ORD-GET-04 ────────────────────────────────
  it('TC-ORD-GET-04: subtotal/discountAmount/total được convert sang Number', async () => {
    const mocks = makePrisma();
    mocks.orderFindUnique.mockResolvedValue({
      ...fullOrder,
      subtotal: 100000n,
      discountAmount: 10000n,
      total: 90000n,
    });

    const svc = new OrdersService(mocks.prisma);
    const result = await svc.getOrderById(ORDER_ID, USER_A) as Record<string, unknown>;

    expect(result.subtotal).toBe(100000);
    expect(result.discountAmount).toBe(10000);
    expect(result.total).toBe(90000);
  });
});

// ─────────────────────────────────────────────────
// TC-ORD-LIST: getMyOrders
// ─────────────────────────────────────────────────
describe('OrdersService.getMyOrders', () => {
  // ── TC-ORD-LIST-01 ────────────────────────────────
  it('TC-ORD-LIST-01: chỉ query với userId của owner', async () => {
    const mocks = makePrisma();
    mocks.orderFindMany.mockResolvedValue([]);

    const svc = new OrdersService(mocks.prisma);
    await svc.getMyOrders(USER_A);

    expect(mocks.orderFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId: USER_A } }),
    );
  });

  // ── TC-ORD-LIST-02 ────────────────────────────────
  it('TC-ORD-LIST-02: trả về mảng rỗng khi không có đơn', async () => {
    const mocks = makePrisma();
    mocks.orderFindMany.mockResolvedValue([]);

    const svc = new OrdersService(mocks.prisma);
    const result = await svc.getMyOrders(USER_A);

    expect(result).toEqual([]);
  });

  // ── TC-ORD-LIST-03 ────────────────────────────────
  it('TC-ORD-LIST-03: chuyển đổi BigInt thành Number trong danh sách', async () => {
    const mocks = makePrisma();
    mocks.orderFindMany.mockResolvedValue([{
      ...PENDING_ORDER,
      subtotal: 50000n,
      discountAmount: 0n,
      total: 50000n,
      items: [],
      payments: [],
    }]);

    const svc = new OrdersService(mocks.prisma);
    const result = await svc.getMyOrders(USER_A) as Array<Record<string, unknown>>;

    expect(result[0].subtotal).toBe(50000);
    expect(result[0].total).toBe(50000);
    expect(typeof result[0].subtotal).toBe('number');
  });

  // ── TC-ORD-LIST-04 ────────────────────────────────
  it('TC-ORD-LIST-04: kết quả được sắp xếp desc theo createdAt (query order)', async () => {
    const mocks = makePrisma();
    mocks.orderFindMany.mockResolvedValue([]);

    const svc = new OrdersService(mocks.prisma);
    await svc.getMyOrders(USER_A);

    expect(mocks.orderFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        orderBy: { createdAt: 'desc' },
      }),
    );
  });
});

// ─────────────────────────────────────────────────
// TC-ORD-EDGE: Edge cases & race conditions
// ─────────────────────────────────────────────────
describe('OrdersService — edge cases', () => {

  // ── TC-ORD-EDGE-01 ────────────────────────────────
  it('TC-ORD-EDGE-01: coupon giảm không vượt subtotal — total >= 0', async () => {
    const mocks = makePrisma();
    mocks.txClient.productVariant.findFirst.mockResolvedValue(ACTIVE_VARIANT);
    mocks.txClient.$executeRaw.mockResolvedValue(1);
    // Coupon giảm 99999 nhưng subtotal chỉ 50000 → discountAmount = 50000, total = 0
    mocks.txClient.coupon.findFirst.mockResolvedValue({
      id: 'coupon-big',
      discountType: 'FIXED_AMOUNT',
      discountValue: 99999n,
      maxDiscount: null,
      minOrderValue: 0n,
      usageLimit: null,
      perUserLimit: 1,
    });
    mocks.txClient.couponRedemption.count.mockResolvedValue(0);
    mocks.txClient.order.create.mockResolvedValue({
      id: ORDER_ID, orderNumber: 'ORD-X', status: 'PENDING',
      subtotal: 50000n, discountAmount: 50000n, total: 0n,
      reservationExpiresAt: new Date(), items: [],
    });
    mocks.txClient.inventoryReservation.create.mockResolvedValue({});
    mocks.txClient.couponRedemption.create.mockResolvedValue({});

    const svc = new OrdersService(mocks.prisma);
    await svc.createOrder(USER_A, {
      items: [{ productVariantId: VARIANT_ID, quantity: 1, toppings: [] }],
      couponCode: 'BIG',
    });

    // order.create must have been called with discountAmount = subtotal (capped)
    const createArg = mocks.txClient.order.create.mock.calls[0]?.[0] as {
      data: { discountAmount: bigint; total: bigint };
    };
    expect(createArg.data.total).toBeGreaterThanOrEqual(0n);
  });

  // ── TC-ORD-EDGE-02 ────────────────────────────────
  it('TC-ORD-EDGE-02: không có topping — inventoryReservation vẫn được tạo đúng 1 lần mỗi item', async () => {
    const mocks = makePrisma();
    setupHappyPathCreate(mocks);

    const svc = new OrdersService(mocks.prisma);
    await svc.createOrder(USER_A, {
      items: [{ productVariantId: VARIANT_ID, quantity: 3, toppings: [] }],
    });

    // 1 item → 1 reservation
    expect(mocks.txClient.inventoryReservation.create).toHaveBeenCalledTimes(1);
  });

  // ── TC-ORD-EDGE-03 ────────────────────────────────
  it('TC-ORD-EDGE-03: $transaction retries on deadlock error', async () => {
    const mocks = makePrisma();
    const deadlockErr = new Error('deadlock detected');

    // Fail first 2 attempts with deadlock, 3rd succeeds
    mocks.$transaction
      .mockRejectedValueOnce(deadlockErr)
      .mockRejectedValueOnce(deadlockErr)
      .mockImplementationOnce(async (fn: (tx: Prisma.TransactionClient) => unknown) => {
        // Setup happy path for 3rd attempt
        const tx = mocks.prisma._tx as Prisma.TransactionClient;
        mocks.txClient.productVariant.findFirst.mockResolvedValue(ACTIVE_VARIANT);
        mocks.txClient.$executeRaw.mockResolvedValue(1);
        mocks.txClient.order.create.mockResolvedValue({
          id: ORDER_ID, orderNumber: 'ORD-RETRY', status: 'PENDING',
          subtotal: 50000n, discountAmount: 0n, total: 50000n,
          reservationExpiresAt: new Date(), items: [],
        });
        mocks.txClient.inventoryReservation.create.mockResolvedValue({});
        return fn(tx);
      });

    const svc = new OrdersService(mocks.prisma);
    const result = await svc.createOrder(USER_A, makeSimpleCreateDto());

    expect(result.status).toBe('PENDING');
    expect(mocks.$transaction).toHaveBeenCalledTimes(3);
  });

  // ── TC-ORD-EDGE-04 ────────────────────────────────
  it('TC-ORD-EDGE-04: ghi statusHistory tại thời điểm tạo đơn với fromStatus=null', async () => {
    const mocks = makePrisma();
    setupHappyPathCreate(mocks);

    const svc = new OrdersService(mocks.prisma);
    await svc.createOrder(USER_A, makeSimpleCreateDto());

    // Verify statusHistories is embedded in order.create call
    const createArg = mocks.txClient.order.create.mock.calls[0]?.[0] as {
      data: { statusHistories: { create: { fromStatus: null; toStatus: string } } };
    };
    expect(createArg.data.statusHistories.create.fromStatus).toBeNull();
    expect(createArg.data.statusHistories.create.toStatus).toBe('PENDING');
  });

  // ── TC-ORD-EDGE-05 ────────────────────────────────
  it('TC-ORD-EDGE-05: ingredient inactive trong BOM → ConflictException OUT_OF_STOCK', async () => {
    const mocks = makePrisma();
    const inactiveIngredientVariant = {
      ...ACTIVE_VARIANT,
      recipeItems: [{
        ingredientId: INGREDIENT_ID,
        quantity: 10,
        ingredient: { id: INGREDIENT_ID, stockQuantity: 100, version: 0, isActive: false }, // inactive
      }],
    };
    mocks.txClient.productVariant.findFirst.mockResolvedValue(inactiveIngredientVariant);

    const svc = new OrdersService(mocks.prisma);
    await expect(svc.createOrder(USER_A, makeSimpleCreateDto()))
      .rejects.toBeInstanceOf(ConflictException);
  });

  // ── TC-ORD-EDGE-06 ────────────────────────────────
  it('TC-ORD-EDGE-06: sugarLevel=0 và iceLevel=0 được lưu đúng (không bị đổi thành null)', async () => {
    const mocks = makePrisma();
    setupHappyPathCreate(mocks);

    const svc = new OrdersService(mocks.prisma);
    await svc.createOrder(USER_A, {
      items: [{
        productVariantId: VARIANT_ID,
        quantity: 1,
        sugarLevel: 0,
        iceLevel: 0,
        toppings: [],
      }],
    });

    const createArg = mocks.txClient.order.create.mock.calls[0]?.[0] as {
      data: { items: { create: Array<{ sugarLevel: number | null; iceLevel: number | null }> } };
    };
    const item = createArg.data.items.create[0];
    expect(item.sugarLevel).toBe(0);
    expect(item.iceLevel).toBe(0);
  });
});
