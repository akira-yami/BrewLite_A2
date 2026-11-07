/**
 * Unit tests for PaymentsService
 *
 * Covers AT-FR-07.1 through AT-FR-07.5:
 *   .1  Amount from server; missing key / bad method → caller rejects before service (controller)
 *   .2  Gateway SUCCESS → SUCCEEDED + PAID + reservation consumed + EARN (one per order)
 *   .3  Same key same payload already SUCCEEDED → replay; PROCESSING → 409; different payload → 409
 *   .4  DECLINE → FAILED + PAYMENT_FAILED; retry with new key → allowed
 *   .5  GATEWAY_TIMEOUT → 503; keep PROCESSING; no new charge
 *
 * All Prisma calls are mocked — no database required.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  ConflictException,
  ForbiddenException,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { PaymentsService } from '../src/modules/payments/payments.service.js';
import type { PrismaService } from '../src/database/prisma.service.js';
import * as mockGateway from '../src/modules/payments/mock-gateway.js';

// ──────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────
const ORDER_ID = 'order-uuid-0001';
const USER_ID = 'user-uuid-0001';
const KEY = 'idem-key-001';
const METHOD = 'E_WALLET' as const;

const pendingOrder = {
  id: ORDER_ID,
  userId: USER_ID,
  status: 'PENDING' as const,
  total: 50000n,
};

/** Build a minimal Prisma mock that satisfies PaymentsService internals */
function makePrisma() {
  // Individual mocks for each Prisma model method used
  const paymentFindUnique = vi.fn();
  const paymentCreate = vi.fn();
  const paymentUpdate = vi.fn();     // top-level (used for DECLINE path)
  const topLevelOrderUpdate = vi.fn(); // top-level order.update (used for DECLINE)

  const orderFindFirst = vi.fn();
  const orderUpdate = vi.fn();
  const paymentCount = vi.fn();

  const orderStatusHistoryCreate = vi.fn();
  const inventoryReservationUpdateMany = vi.fn();
  const couponRedemptionUpdateMany = vi.fn();

  const loyaltyTransactionCreate = vi.fn();
  const userFindUnique = vi.fn();
  const userUpdate = vi.fn();

  // $transaction: first call (short lock) and second call (finalize) behave differently.
  // We implement it as a pass-through that runs the callback with the same mock client.
  const txClient = {
    order: { findFirst: orderFindFirst, update: orderUpdate },
    payment: { count: paymentCount, create: paymentCreate, update: paymentUpdate },
    orderStatusHistory: { create: orderStatusHistoryCreate },
    inventoryReservation: { updateMany: inventoryReservationUpdateMany },
    couponRedemption: { updateMany: couponRedemptionUpdateMany },
    loyaltyTransaction: { create: loyaltyTransactionCreate },
    user: { findUnique: userFindUnique, update: userUpdate },
  };

  const $transaction = vi.fn(async (fn: (tx: typeof txClient) => unknown) => fn(txClient));

  const prisma = {
    payment: {
      findUnique: paymentFindUnique,
      create: paymentCreate,
      update: paymentUpdate,
    },
    order: { update: topLevelOrderUpdate },
    $transaction,
    // Expose inner tx mocks for fine-grained assertions
    _tx: txClient,
  } as unknown as PrismaService & { _tx: typeof txClient };

  return { prisma, $transaction, txClient, paymentFindUnique, paymentCreate, paymentUpdate, topLevelOrderUpdate, orderFindFirst, orderUpdate, paymentCount };
}

// ──────────────────────────────────────────────
// Test suite
// ──────────────────────────────────────────────

beforeEach(() => {
  mockGateway.__clearForTests();
  vi.unstubAllEnvs();
});

describe('PaymentsService.pay — Phase 1: idempotency guard', () => {
  it('replays a previously SUCCEEDED attempt with the same key+hash (AT-FR-07.3)', async () => {
    const { prisma, paymentFindUnique } = makePrisma();
    paymentFindUnique.mockResolvedValue({
      id: 'pay-1',
      status: 'SUCCEEDED',
      orderId: ORDER_ID,
      requestHash: require('node:crypto').createHash('sha256').update(`${ORDER_ID}|${METHOD}`).digest('hex'),
    });
    const svc = new PaymentsService(prisma);
    const result = await svc.pay(USER_ID, ORDER_ID, METHOD, KEY);
    expect(result.status).toBe('SUCCEEDED');
    // Must NOT call $transaction (no new charge)
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('throws IDEMPOTENCY_KEY_REUSED when payload hash differs (AT-FR-07.3)', async () => {
    const { prisma, paymentFindUnique } = makePrisma();
    paymentFindUnique.mockResolvedValue({
      id: 'pay-1',
      status: 'SUCCEEDED',
      orderId: ORDER_ID,
      requestHash: 'totally-different-hash',
    });
    const svc = new PaymentsService(prisma);
    await expect(svc.pay(USER_ID, ORDER_ID, METHOD, KEY))
      .rejects.toMatchObject({ message: 'IDEMPOTENCY_KEY_REUSED' });
  });

  it('throws PAYMENT_IN_PROGRESS when same key is still PROCESSING (AT-FR-07.3)', async () => {
    const { prisma, paymentFindUnique } = makePrisma();
    paymentFindUnique.mockResolvedValue({
      id: 'pay-1',
      status: 'PROCESSING',
      orderId: ORDER_ID,
      requestHash: require('node:crypto').createHash('sha256').update(`${ORDER_ID}|${METHOD}`).digest('hex'),
    });
    const svc = new PaymentsService(prisma);
    await expect(svc.pay(USER_ID, ORDER_ID, METHOD, KEY))
      .rejects.toBeInstanceOf(ConflictException);
  });
});

describe('PaymentsService.pay — Phase 2: attempt creation guards', () => {
  it('throws NotFoundException when order not found', async () => {
    const { prisma, paymentFindUnique, txClient } = makePrisma();
    paymentFindUnique.mockResolvedValue(null);
    txClient.order.findFirst.mockResolvedValue(null);

    const svc = new PaymentsService(prisma);
    await expect(svc.pay(USER_ID, ORDER_ID, METHOD, KEY))
      .rejects.toBeInstanceOf(NotFoundException);
  });

  it('throws ForbiddenException when userId does not own the order', async () => {
    const { prisma, paymentFindUnique, txClient } = makePrisma();
    paymentFindUnique.mockResolvedValue(null);
    txClient.order.findFirst.mockResolvedValue({ ...pendingOrder, userId: 'other-user' });

    const svc = new PaymentsService(prisma);
    await expect(svc.pay(USER_ID, ORDER_ID, METHOD, KEY))
      .rejects.toBeInstanceOf(ForbiddenException);
  });

  it('throws ORDER_INVALID_TRANSITION when order is PAID', async () => {
    const { prisma, paymentFindUnique, txClient } = makePrisma();
    paymentFindUnique.mockResolvedValue(null);
    txClient.order.findFirst.mockResolvedValue({ ...pendingOrder, status: 'PAID' });

    const svc = new PaymentsService(prisma);
    await expect(svc.pay(USER_ID, ORDER_ID, METHOD, KEY))
      .rejects.toMatchObject({ message: 'ORDER_INVALID_TRANSITION' });
  });

  it('throws PAYMENT_IN_PROGRESS when another PROCESSING attempt exists (AT-FR-07.3)', async () => {
    const { prisma, paymentFindUnique, txClient } = makePrisma();
    paymentFindUnique.mockResolvedValue(null);
    txClient.order.findFirst.mockResolvedValue(pendingOrder);
    txClient.payment.count
      .mockResolvedValueOnce(1)   // inFlight > 0
      .mockResolvedValueOnce(0);

    const svc = new PaymentsService(prisma);
    await expect(svc.pay(USER_ID, ORDER_ID, METHOD, KEY))
      .rejects.toBeInstanceOf(ConflictException);
  });

  it('throws ORDER_ALREADY_PAID when a SUCCEEDED payment already exists (AT-FR-07.3)', async () => {
    const { prisma, paymentFindUnique, txClient } = makePrisma();
    paymentFindUnique.mockResolvedValue(null);
    txClient.order.findFirst.mockResolvedValue(pendingOrder);
    txClient.payment.count
      .mockResolvedValueOnce(0)   // inFlight = 0
      .mockResolvedValueOnce(1);  // succeeded > 0

    const svc = new PaymentsService(prisma);
    await expect(svc.pay(USER_ID, ORDER_ID, METHOD, KEY))
      .rejects.toMatchObject({ message: 'ORDER_ALREADY_PAID' });
  });
});

describe('PaymentsService.pay — Phase 3: gateway + finalization', () => {
  it('returns SUCCEEDED after gateway SUCCESS and commits all side effects (AT-FR-07.2)', async () => {
    const mocks = makePrisma();
    const attempt = { id: 'pay-1', orderId: ORDER_ID };
    const { paymentFindUnique, txClient } = mocks;

    paymentFindUnique.mockResolvedValue(null);
    txClient.order.findFirst
      .mockResolvedValueOnce(pendingOrder)
      .mockResolvedValueOnce({ ...pendingOrder, status: 'PENDING' });
    txClient.payment.count
      .mockResolvedValueOnce(0)
      .mockResolvedValueOnce(0)
      .mockResolvedValueOnce(0);
    txClient.payment.create.mockResolvedValue(attempt);
    txClient.payment.update.mockResolvedValue({});
    txClient.order.update.mockResolvedValue({});
    txClient.orderStatusHistory.create.mockResolvedValue({});
    txClient.inventoryReservation.updateMany.mockResolvedValue({});
    txClient.couponRedemption.updateMany.mockResolvedValue({});
    txClient.loyaltyTransaction.create.mockResolvedValue({});
    txClient.user.findUnique.mockResolvedValue({ loyaltyBalance: 0 });
    txClient.user.update.mockResolvedValue({});

    vi.stubEnv('MOCK_PAYMENT_OUTCOME', 'SUCCESS');
    const svc = new PaymentsService(mocks.prisma);
    const result = await svc.pay(USER_ID, ORDER_ID, METHOD, KEY);

    expect(result.status).toBe('SUCCEEDED');
    expect(result.orderId).toBe(ORDER_ID);
  });

  it('calculates loyalty points as floor(total/1000) = 50 for total 50000 (AT-FR-10.3)', async () => {
    const mocks = makePrisma();
    const attempt = { id: 'pay-1', orderId: ORDER_ID };
    const { paymentFindUnique, txClient } = mocks;

    paymentFindUnique.mockResolvedValue(null);
    txClient.order.findFirst
      .mockResolvedValueOnce(pendingOrder)
      .mockResolvedValueOnce({ ...pendingOrder, status: 'PENDING' });
    txClient.payment.count
      .mockResolvedValueOnce(0)
      .mockResolvedValueOnce(0)
      .mockResolvedValueOnce(0);
    txClient.payment.create.mockResolvedValue(attempt);
    txClient.payment.update.mockResolvedValue({});
    txClient.order.update.mockResolvedValue({});
    txClient.orderStatusHistory.create.mockResolvedValue({});
    txClient.inventoryReservation.updateMany.mockResolvedValue({});
    txClient.couponRedemption.updateMany.mockResolvedValue({});
    txClient.loyaltyTransaction.create.mockResolvedValue({});
    txClient.user.findUnique.mockResolvedValue({ loyaltyBalance: 0 });
    txClient.user.update.mockResolvedValue({});

    vi.stubEnv('MOCK_PAYMENT_OUTCOME', 'SUCCESS');
    const svc = new PaymentsService(mocks.prisma);
    await svc.pay(USER_ID, ORDER_ID, METHOD, KEY);

    // loyaltyTransaction.create should have been called with points = floor(50000/1000) = 50
    expect(txClient.loyaltyTransaction.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ points: 50, type: 'EARN' }) }),
    );
  });

  it('returns FAILED after gateway DECLINE without loyalty EARN (AT-FR-07.4)', async () => {
    const mocks = makePrisma();
    const attempt = { id: 'pay-1', orderId: ORDER_ID };
    const { paymentFindUnique, txClient, paymentUpdate, topLevelOrderUpdate } = mocks;
    paymentFindUnique.mockResolvedValue(null);
    txClient.order.findFirst.mockResolvedValue(pendingOrder);
    txClient.payment.count
      .mockResolvedValueOnce(0)
      .mockResolvedValueOnce(0);
    txClient.payment.create.mockResolvedValue(attempt);
    // top-level update mocks for decline finalize path
    paymentUpdate.mockResolvedValue({});
    topLevelOrderUpdate.mockResolvedValue({});

    vi.stubEnv('MOCK_PAYMENT_OUTCOME', 'DECLINE');
    const svc = new PaymentsService(mocks.prisma);
    const result = await svc.pay(USER_ID, ORDER_ID, METHOD, KEY);

    expect(result.status).toBe('FAILED');
    // No loyalty EARN was called
    expect(txClient.loyaltyTransaction.create).not.toHaveBeenCalled();
  });

  it('throws ServiceUnavailableException on GATEWAY_TIMEOUT and keeps attempt PROCESSING (AT-FR-07.5)', async () => {
    const mocks = makePrisma();
    const attempt = { id: 'pay-1', orderId: ORDER_ID };
    const { paymentFindUnique, txClient } = mocks;
    paymentFindUnique.mockResolvedValue(null);
    txClient.order.findFirst.mockResolvedValue(pendingOrder);
    txClient.payment.count
      .mockResolvedValueOnce(0)
      .mockResolvedValueOnce(0);
    txClient.payment.create.mockResolvedValue(attempt);

    vi.stubEnv('MOCK_PAYMENT_OUTCOME', 'TIMEOUT');
    const svc = new PaymentsService(mocks.prisma);
    await expect(svc.pay(USER_ID, ORDER_ID, METHOD, KEY))
      .rejects.toBeInstanceOf(ServiceUnavailableException);

    // Attempt was created but NOT updated to FAILED (stays PROCESSING for reconciliation)
    expect(txClient.payment.update).not.toHaveBeenCalled();
  });
});

describe('PaymentsService.pay — idempotency: gateway chargeOnce is called at most once per key', () => {
  it('does not call gateway again for a completed SUCCEEDED attempt (AT-FR-07.3 replay)', async () => {
    const crypto = await import('node:crypto');
    const hash = crypto.createHash('sha256').update(`${ORDER_ID}|${METHOD}`).digest('hex');

    const { prisma, paymentFindUnique } = makePrisma();
    paymentFindUnique.mockResolvedValue({ id: 'pay-1', status: 'SUCCEEDED', orderId: ORDER_ID, requestHash: hash });

    const chargeSpy = vi.spyOn(mockGateway, 'chargeOnce');
    const svc = new PaymentsService(prisma);
    await svc.pay(USER_ID, ORDER_ID, METHOD, KEY);
    expect(chargeSpy).not.toHaveBeenCalled();
  });
});

describe('PaymentsService.pay — concurrent PROCESSING guard', () => {
  it('a second concurrent call with a DIFFERENT key sees PAYMENT_IN_PROGRESS (AT-FR-07.3)', async () => {
    const KEY2 = 'idem-key-002';
    const { prisma, paymentFindUnique, txClient } = makePrisma();
    // Key2 has no record
    paymentFindUnique.mockResolvedValue(null);
    // Order is PENDING but there IS an in-flight PROCESSING attempt
    txClient.order.findFirst.mockResolvedValue(pendingOrder);
    txClient.payment.count
      .mockResolvedValueOnce(1)  // inFlight > 0
      .mockResolvedValueOnce(0);

    const svc = new PaymentsService(prisma);
    await expect(svc.pay(USER_ID, ORDER_ID, METHOD, KEY2))
      .rejects.toBeInstanceOf(ConflictException);
  });
});

describe('PaymentsService.pay — ownership: cross-user rejection (AT-FR-05.4 / AT-FR-07.3)', () => {
  it('forbids user B from paying order of user A', async () => {
    const OTHER_USER = 'user-uuid-9999';
    const { prisma, paymentFindUnique, txClient } = makePrisma();
    paymentFindUnique.mockResolvedValue(null);
    // Order belongs to USER_ID, not OTHER_USER
    txClient.order.findFirst.mockResolvedValue(pendingOrder); // pendingOrder.userId = USER_ID

    const svc = new PaymentsService(prisma);
    await expect(svc.pay(OTHER_USER, ORDER_ID, METHOD, KEY))
      .rejects.toBeInstanceOf(ForbiddenException);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Extended test cases – bổ sung cho issue A2-5.2.1.2 / #31
// ─────────────────────────────────────────────────────────────────────────────

describe('PaymentsService.pay — Phase 4: finalize edge cases (AT-FR-07.2, AT-FR-07.3)', () => {
  it('TC-PAY-EXT-01: order bị CANCELLED giữa lúc gateway SUCCESS và finalize — attempt chuyển FAILED với ORDER_CANCELLED', async () => {
    const mocks = makePrisma();
    const attempt = { id: 'pay-1', orderId: ORDER_ID };
    const { paymentFindUnique, txClient } = mocks;

    paymentFindUnique.mockResolvedValue(null);

    // Phase 2: order PENDING → tạo attempt
    txClient.order.findFirst
      .mockResolvedValueOnce(pendingOrder) // short-lock trong phase 2
      .mockResolvedValueOnce(null);         // finalize: order gone/cancelled

    txClient.payment.count
      .mockResolvedValueOnce(0)  // inFlight = 0
      .mockResolvedValueOnce(0); // succeeded = 0
    txClient.payment.create.mockResolvedValue(attempt);

    // finalize transaction — khi freshOrder = null → update FAILED
    txClient.payment.update.mockResolvedValue({});

    vi.stubEnv('MOCK_PAYMENT_OUTCOME', 'SUCCESS');
    const svc = new PaymentsService(mocks.prisma);
    await svc.pay(USER_ID, ORDER_ID, METHOD, KEY);

    // Payment phải được cập nhật sang FAILED vì order đã mất
    expect(txClient.payment.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: 'FAILED',
          failureCode: 'ORDER_CANCELLED',
        }),
      }),
    );
    // Không được cộng điểm
    expect(txClient.loyaltyTransaction.create).not.toHaveBeenCalled();
  });

  it('TC-PAY-EXT-02: duplicate SUCCESS guard — alreadySucceeded > 0 trong finalize → attempt FAILED DUPLICATE_SUCCESS', async () => {
    const mocks = makePrisma();
    const attempt = { id: 'pay-1', orderId: ORDER_ID };
    const { paymentFindUnique, txClient } = mocks;

    paymentFindUnique.mockResolvedValue(null);

    txClient.order.findFirst
      .mockResolvedValueOnce(pendingOrder)                         // phase 2 lock
      .mockResolvedValueOnce({ ...pendingOrder, status: 'PAID' }); // finalize (already PAID)
    txClient.payment.count
      .mockResolvedValueOnce(0)   // inFlight = 0
      .mockResolvedValueOnce(0)   // succeeded = 0 (phase 2)
      .mockResolvedValueOnce(1);  // alreadySucceeded = 1 (finalize guard)
    txClient.payment.create.mockResolvedValue(attempt);
    txClient.payment.update.mockResolvedValue({});

    vi.stubEnv('MOCK_PAYMENT_OUTCOME', 'SUCCESS');
    const svc = new PaymentsService(mocks.prisma);
    await svc.pay(USER_ID, ORDER_ID, METHOD, KEY);

    expect(txClient.payment.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: 'FAILED',
          failureCode: 'DUPLICATE_SUCCESS',
        }),
      }),
    );
  });

  it('TC-PAY-EXT-03: loyalty EARN bằng 0 khi total < 1000 VND → loyaltyTransaction KHÔNG được tạo', async () => {
    const mocks = makePrisma();
    const smallTotalOrder = { ...pendingOrder, total: 500n }; // 500 VND < 1000
    const attempt = { id: 'pay-1', orderId: ORDER_ID };
    const { paymentFindUnique, txClient } = mocks;

    paymentFindUnique.mockResolvedValue(null);
    txClient.order.findFirst
      .mockResolvedValueOnce(smallTotalOrder)
      .mockResolvedValueOnce({ ...smallTotalOrder, status: 'PENDING' });
    txClient.payment.count
      .mockResolvedValueOnce(0)
      .mockResolvedValueOnce(0)
      .mockResolvedValueOnce(0);
    txClient.payment.create.mockResolvedValue(attempt);
    txClient.payment.update.mockResolvedValue({});
    txClient.order.update.mockResolvedValue({});
    txClient.orderStatusHistory.create.mockResolvedValue({});
    txClient.inventoryReservation.updateMany.mockResolvedValue({});
    txClient.couponRedemption.updateMany.mockResolvedValue({});
    txClient.user.findUnique.mockResolvedValue({ loyaltyBalance: 0 });

    vi.stubEnv('MOCK_PAYMENT_OUTCOME', 'SUCCESS');
    const svc = new PaymentsService(mocks.prisma);
    const result = await svc.pay(USER_ID, ORDER_ID, METHOD, KEY);

    expect(result.status).toBe('SUCCEEDED');
    // floor(500/1000) = 0 → không tạo loyalty transaction
    expect(txClient.loyaltyTransaction.create).not.toHaveBeenCalled();
    // user.update cũng không được gọi
    expect(txClient.user.update).not.toHaveBeenCalled();
  });

  it('TC-PAY-EXT-04: loyalty EARN tích lũy vào balanceAfter đúng (AT-FR-10.3)', async () => {
    const mocks = makePrisma();
    const bigTotalOrder = { ...pendingOrder, total: 114000n }; // floor(114000/1000) = 114 điểm
    const attempt = { id: 'pay-1', orderId: ORDER_ID };
    const { paymentFindUnique, txClient } = mocks;

    paymentFindUnique.mockResolvedValue(null);
    txClient.order.findFirst
      .mockResolvedValueOnce(bigTotalOrder)
      .mockResolvedValueOnce({ ...bigTotalOrder, status: 'PENDING' });
    txClient.payment.count
      .mockResolvedValueOnce(0)
      .mockResolvedValueOnce(0)
      .mockResolvedValueOnce(0);
    txClient.payment.create.mockResolvedValue(attempt);
    txClient.payment.update.mockResolvedValue({});
    txClient.order.update.mockResolvedValue({});
    txClient.orderStatusHistory.create.mockResolvedValue({});
    txClient.inventoryReservation.updateMany.mockResolvedValue({});
    txClient.couponRedemption.updateMany.mockResolvedValue({});
    // User đã có 200 điểm từ trước
    txClient.user.findUnique.mockResolvedValue({ loyaltyBalance: 200 });
    txClient.loyaltyTransaction.create.mockResolvedValue({});
    txClient.user.update.mockResolvedValue({});

    vi.stubEnv('MOCK_PAYMENT_OUTCOME', 'SUCCESS');
    const svc = new PaymentsService(mocks.prisma);
    await svc.pay(USER_ID, ORDER_ID, METHOD, KEY);

    // balanceAfter = 200 + 114 = 314
    expect(txClient.loyaltyTransaction.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          type: 'EARN',
          points: 114,
          balanceAfter: 314,
        }),
      }),
    );
    expect(txClient.user.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { loyaltyBalance: 314 },
      }),
    );
  });
});

describe('PaymentsService.pay — PAYMENT_FAILED retry flow (AT-FR-07.4)', () => {
  it('TC-PAY-EXT-05: đơn PAYMENT_FAILED được phép retry với key mới (AT-FR-07.4)', async () => {
    const KEY_RETRY = 'idem-key-retry-002';
    const failedOrder = { ...pendingOrder, status: 'PAYMENT_FAILED' as const };
    const attempt = { id: 'pay-2', orderId: ORDER_ID };
    const mocks = makePrisma();
    const { paymentFindUnique, txClient } = mocks;

    // Key mới → không có existing payment
    paymentFindUnique.mockResolvedValue(null);
    txClient.order.findFirst
      .mockResolvedValueOnce(failedOrder)
      .mockResolvedValueOnce({ ...failedOrder, status: 'PAYMENT_FAILED' });
    txClient.payment.count
      .mockResolvedValueOnce(0)  // inFlight = 0
      .mockResolvedValueOnce(0)  // succeeded = 0
      .mockResolvedValueOnce(0); // alreadySucceeded = 0 in finalize
    txClient.payment.create.mockResolvedValue(attempt);
    txClient.payment.update.mockResolvedValue({});
    txClient.order.update.mockResolvedValue({});
    txClient.orderStatusHistory.create.mockResolvedValue({});
    txClient.inventoryReservation.updateMany.mockResolvedValue({});
    txClient.couponRedemption.updateMany.mockResolvedValue({});
    txClient.loyaltyTransaction.create.mockResolvedValue({});
    txClient.user.findUnique.mockResolvedValue({ loyaltyBalance: 0 });
    txClient.user.update.mockResolvedValue({});

    vi.stubEnv('MOCK_PAYMENT_OUTCOME', 'SUCCESS');
    const svc = new PaymentsService(mocks.prisma);
    const result = await svc.pay(USER_ID, ORDER_ID, METHOD, KEY_RETRY);

    expect(result.status).toBe('SUCCEEDED');
  });

  it('TC-PAY-EXT-06: đơn COMPLETED không thể thanh toán → ORDER_INVALID_TRANSITION', async () => {
    const { prisma, paymentFindUnique, txClient } = makePrisma();
    paymentFindUnique.mockResolvedValue(null);
    txClient.order.findFirst.mockResolvedValue({ ...pendingOrder, status: 'COMPLETED' as const });

    const svc = new PaymentsService(prisma);
    await expect(svc.pay(USER_ID, ORDER_ID, METHOD, KEY))
      .rejects.toMatchObject({ message: 'ORDER_INVALID_TRANSITION' });
  });

  it('TC-PAY-EXT-07: đơn CANCELLED không thể thanh toán → ORDER_INVALID_TRANSITION', async () => {
    const { prisma, paymentFindUnique, txClient } = makePrisma();
    paymentFindUnique.mockResolvedValue(null);
    txClient.order.findFirst.mockResolvedValue({ ...pendingOrder, status: 'CANCELLED' as const });

    const svc = new PaymentsService(prisma);
    await expect(svc.pay(USER_ID, ORDER_ID, METHOD, KEY))
      .rejects.toMatchObject({ message: 'ORDER_INVALID_TRANSITION' });
  });

  it('TC-PAY-EXT-08: đơn PREPARING không thể thanh toán → ORDER_INVALID_TRANSITION', async () => {
    const { prisma, paymentFindUnique, txClient } = makePrisma();
    paymentFindUnique.mockResolvedValue(null);
    txClient.order.findFirst.mockResolvedValue({ ...pendingOrder, status: 'PREPARING' as const });

    const svc = new PaymentsService(prisma);
    await expect(svc.pay(USER_ID, ORDER_ID, METHOD, KEY))
      .rejects.toMatchObject({ message: 'ORDER_INVALID_TRANSITION' });
  });
});

describe('PaymentsService.pay — Coupon consumption (AT-FR-10.2)', () => {
  it('TC-PAY-EXT-09: couponRedemption.updateMany được gọi với status CONSUMED sau SUCCESS', async () => {
    const mocks = makePrisma();
    const attempt = { id: 'pay-1', orderId: ORDER_ID };
    const { paymentFindUnique, txClient } = mocks;

    paymentFindUnique.mockResolvedValue(null);
    txClient.order.findFirst
      .mockResolvedValueOnce(pendingOrder)
      .mockResolvedValueOnce({ ...pendingOrder, status: 'PENDING' });
    txClient.payment.count
      .mockResolvedValueOnce(0)
      .mockResolvedValueOnce(0)
      .mockResolvedValueOnce(0);
    txClient.payment.create.mockResolvedValue(attempt);
    txClient.payment.update.mockResolvedValue({});
    txClient.order.update.mockResolvedValue({});
    txClient.orderStatusHistory.create.mockResolvedValue({});
    txClient.inventoryReservation.updateMany.mockResolvedValue({});
    txClient.couponRedemption.updateMany.mockResolvedValue({});
    txClient.loyaltyTransaction.create.mockResolvedValue({});
    txClient.user.findUnique.mockResolvedValue({ loyaltyBalance: 0 });
    txClient.user.update.mockResolvedValue({});

    vi.stubEnv('MOCK_PAYMENT_OUTCOME', 'SUCCESS');
    const svc = new PaymentsService(mocks.prisma);
    await svc.pay(USER_ID, ORDER_ID, METHOD, KEY);

    // Coupon phải được consume trong transaction finalize
    expect(txClient.couponRedemption.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ orderId: ORDER_ID, status: 'RESERVED' }),
        data: expect.objectContaining({ status: 'CONSUMED' }),
      }),
    );
  });

  it('TC-PAY-EXT-10: couponRedemption.updateMany KHÔNG được gọi sau DECLINE', async () => {
    const mocks = makePrisma();
    const attempt = { id: 'pay-2', orderId: ORDER_ID };
    const { paymentFindUnique, txClient, paymentUpdate, topLevelOrderUpdate } = mocks;

    paymentFindUnique.mockResolvedValue(null);
    txClient.order.findFirst.mockResolvedValue(pendingOrder);
    txClient.payment.count
      .mockResolvedValueOnce(0)
      .mockResolvedValueOnce(0);
    txClient.payment.create.mockResolvedValue(attempt);
    paymentUpdate.mockResolvedValue({});
    topLevelOrderUpdate.mockResolvedValue({});

    vi.stubEnv('MOCK_PAYMENT_OUTCOME', 'DECLINE');
    const svc = new PaymentsService(mocks.prisma);
    await svc.pay(USER_ID, ORDER_ID, METHOD, 'key-decline-coupon');

    // Trong transaction finalize không được chạy (DECLINE không vào finalize tx)
    expect(txClient.couponRedemption.updateMany).not.toHaveBeenCalled();
  });
});

describe('PaymentsService.pay — Inventory reservation consumption (AT-FR-06.3)', () => {
  it('TC-PAY-EXT-11: inventoryReservation.updateMany được gọi với CONSUMED sau SUCCESS', async () => {
    const mocks = makePrisma();
    const attempt = { id: 'pay-1', orderId: ORDER_ID };
    const { paymentFindUnique, txClient } = mocks;

    paymentFindUnique.mockResolvedValue(null);
    txClient.order.findFirst
      .mockResolvedValueOnce(pendingOrder)
      .mockResolvedValueOnce({ ...pendingOrder, status: 'PENDING' });
    txClient.payment.count
      .mockResolvedValueOnce(0)
      .mockResolvedValueOnce(0)
      .mockResolvedValueOnce(0);
    txClient.payment.create.mockResolvedValue(attempt);
    txClient.payment.update.mockResolvedValue({});
    txClient.order.update.mockResolvedValue({});
    txClient.orderStatusHistory.create.mockResolvedValue({});
    txClient.inventoryReservation.updateMany.mockResolvedValue({});
    txClient.couponRedemption.updateMany.mockResolvedValue({});
    txClient.loyaltyTransaction.create.mockResolvedValue({});
    txClient.user.findUnique.mockResolvedValue({ loyaltyBalance: 0 });
    txClient.user.update.mockResolvedValue({});

    vi.stubEnv('MOCK_PAYMENT_OUTCOME', 'SUCCESS');
    const svc = new PaymentsService(mocks.prisma);
    await svc.pay(USER_ID, ORDER_ID, METHOD, KEY);

    expect(txClient.inventoryReservation.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ orderId: ORDER_ID, status: 'ACTIVE' }),
        data: { status: 'CONSUMED' },
      }),
    );
  });
});

describe('PaymentsService.pay — OrderStatusHistory ghi đúng transition (AT-FR-09.1)', () => {
  it('TC-PAY-EXT-12: history entry PENDING → PAID được tạo sau SUCCESS', async () => {
    const mocks = makePrisma();
    const attempt = { id: 'pay-1', orderId: ORDER_ID };
    const { paymentFindUnique, txClient } = mocks;

    paymentFindUnique.mockResolvedValue(null);
    txClient.order.findFirst
      .mockResolvedValueOnce(pendingOrder)
      .mockResolvedValueOnce({ ...pendingOrder, status: 'PENDING' });
    txClient.payment.count
      .mockResolvedValueOnce(0)
      .mockResolvedValueOnce(0)
      .mockResolvedValueOnce(0);
    txClient.payment.create.mockResolvedValue(attempt);
    txClient.payment.update.mockResolvedValue({});
    txClient.order.update.mockResolvedValue({});
    txClient.orderStatusHistory.create.mockResolvedValue({});
    txClient.inventoryReservation.updateMany.mockResolvedValue({});
    txClient.couponRedemption.updateMany.mockResolvedValue({});
    txClient.loyaltyTransaction.create.mockResolvedValue({});
    txClient.user.findUnique.mockResolvedValue({ loyaltyBalance: 0 });
    txClient.user.update.mockResolvedValue({});

    vi.stubEnv('MOCK_PAYMENT_OUTCOME', 'SUCCESS');
    const svc = new PaymentsService(mocks.prisma);
    await svc.pay(USER_ID, ORDER_ID, METHOD, KEY);

    expect(txClient.orderStatusHistory.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          orderId: ORDER_ID,
          fromStatus: 'PENDING',
          toStatus: 'PAID',
          changedByUserId: USER_ID,
        }),
      }),
    );
  });
});
