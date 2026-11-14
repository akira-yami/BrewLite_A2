// Kiểm tra đơn hết hạn khi thanh toán đang xử lý, khôi phục kết quả và hoàn tác trên PostgreSQL.
import { PrismaPg } from '@prisma/adapter-pg';
import { createHmac, randomUUID } from 'node:crypto';
import { vi } from 'vitest';
import { PrismaClient } from '../../src/generated/prisma/client.js';
import { loadAppConfig } from '../../src/config/app-config.js';
import { InventoryRepository } from '../../src/modules/inventory/repositories/inventory.repository.js';
import { InventoryService } from '../../src/modules/inventory/services/inventory.service.js';
import { OrdersRepository } from '../../src/modules/orders/repositories/orders.repository.js';
import { OrdersService } from '../../src/modules/orders/services/orders.service.js';
import { OrderExpiryJob } from '../../src/modules/orders/services/order-expiry.job.js';
import { PaymentsRepository } from '../../src/modules/payments/repositories/payments.repository.js';
import { PaymentsService } from '../../src/modules/payments/services/payments.service.js';
import { PaymentRecoveryService } from '../../src/modules/payments/services/payment-recovery.service.js';
import { VnpayGatewayService } from '../../src/modules/payments/services/vnpay.gateway.js';
import { PromotionsRepository } from '../../src/modules/promotions/repositories/promotions.repository.js';
import { PromotionsService } from '../../src/modules/promotions/services/promotions.service.js';

const connectionString = process.env.SMOKE_DATABASE_URL;
if (!connectionString || !new URL(connectionString).pathname.slice(1).startsWith('brewlite_foundation_smoke')) {
  throw new Error('Set SMOKE_DATABASE_URL to the disposable BrewLite smoke database');
}

describe('Thanh toán và hết hạn giữ nguyên liệu trên PostgreSQL', () => {
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
  const ordersRepo = new OrdersRepository(prisma as never);
  const inventory = new InventoryService(prisma as never, new InventoryRepository({} as never));
  const promotionsRepo = new PromotionsRepository(prisma as never);
  const promotions = new PromotionsService(promotionsRepo);
  const orders = new OrdersService(ordersRepo, prisma as never, promotions, {} as never, inventory, {} as never, loadAppConfig({ NODE_ENV: 'test' }));
  const job = () => new OrderExpiryJob(prisma as never, ordersRepo, inventory, promotions);

  beforeAll(() => prisma.$connect());
  afterAll(() => prisma.$disconnect());
  afterEach(() => vi.restoreAllMocks());

  async function fixture(status: 'PENDING' | 'PAYMENT_FAILED' = 'PENDING') {
    const user = await prisma.user.create({ data: { username: `ttl-${randomUUID()}`, passwordHash: 'test-only' } });
    const ingredient = await prisma.ingredient.create({ data: { code: `TTL-${randomUUID()}`, name: 'TTL beans', unit: 'G', stockQuantity: 20 } });
    const product = await prisma.product.create({
      data: { sku: `TTL-${randomUUID()}`, name: 'TTL coffee', imageUrl: '/test.png', variants: { create: { size: 'M', price: 40000n, recipeItems: { create: { ingredientId: ingredient.id, quantity: 10 } } } } },
      include: { variants: true },
    });
    const coupon = await prisma.coupon.create({ data: {
      code: `TTL-${randomUUID()}`, discountType: 'FIXED_AMOUNT', discountValue: 1000n,
      startsAt: new Date(Date.now() - 60000), endsAt: new Date(Date.now() + 3600000), usageLimit: 1, perUserLimit: 1,
    } });
    const expiresAt = new Date(Date.now() + 60000);
    const order = await prisma.$transaction(async tx => {
      const order = await tx.order.create({ data: {
        orderNumber: `TTL-${randomUUID().slice(0, 20)}`, userId: user.id, status,
        subtotal: 40000n, discountAmount: 1000n, total: 39000n, reservationExpiresAt: expiresAt,
      } });
      await inventory.reserve(tx, order.id, [{ productVariantId: product.variants[0].id, quantity: 1 }], expiresAt);
      await promotionsRepo.createRedemption({ couponId: coupon.id, userId: user.id, orderId: order.id, discountAmount: 1000n, expiresAt }, tx);
      return order;
    });
    const expire = async () => {
      const past = new Date(Date.now() - 1000);
      await prisma.order.update({ where: { id: order.id }, data: { reservationExpiresAt: past } });
      await prisma.inventoryReservation.updateMany({ where: { orderId: order.id }, data: { expiresAt: past } });
      await prisma.couponRedemption.updateMany({ where: { orderId: order.id }, data: { expiresAt: past } });
    };
    const state = async () => ({
      order: await prisma.order.findUniqueOrThrow({ where: { id: order.id } }),
      stock: await prisma.ingredient.findUniqueOrThrow({ where: { id: ingredient.id } }),
      reservation: await prisma.inventoryReservation.findFirstOrThrow({ where: { orderId: order.id } }),
      coupon: await prisma.couponRedemption.findUniqueOrThrow({ where: { orderId: order.id } }),
      cancellations: await prisma.orderStatusHistory.count({ where: { orderId: order.id, toStatus: 'CANCELLED' } }),
    });
    const params = { orderId: order.id, userId: user.id, amount: 39000n, method: 'E_WALLET' as const, idempotencyKey: randomUUID() };
    return { order, user, coupon, expire, state, params };
  }

  it.each(['PENDING', 'PAYMENT_FAILED'] as const)('expires %s stock and coupon exactly once across workers', async status => {
    const f = await fixture(status);
    await f.expire();
    await Promise.all([job().handleExpiredOrders(), job().handleExpiredOrders()]);
    const first = await f.state();
    expect(first.order.status).toBe('CANCELLED');
    expect(first.reservation.status).toBe('EXPIRED');
    expect(first.coupon.status).toBe('EXPIRED');
    expect(first.coupon.releasedAt).not.toBeNull();
    expect(first.stock.stockQuantity).toBe(20);
    expect(first.stock.version).toBe(2);
    expect(first.cancellations).toBe(1);
    expect(await promotions.validateCoupon(f.coupon.code, 40000, f.user.id, new Date())).toMatchObject({ discountAmount: 1000 });
    await job().handleExpiredOrders();
    expect(await f.state()).toEqual(first);
  });

  it('rolls back order, inventory and history if coupon cleanup fails', async () => {
    const f = await fixture();
    await f.expire();
    const before = await f.state();
    vi.spyOn(promotions, 'releaseRedemption').mockRejectedValueOnce(new Error('coupon write failed'));
    await job().handleExpiredOrders();
    expect(await f.state()).toEqual(before);
    await job().handleExpiredOrders();
    expect((await f.state()).order.status).toBe('CANCELLED');
  });

  for (const success of [true, false]) {
    it(`Xử lý kết quả cổng ${success ? 'thành công' : 'thất bại'} trả về sau hạn`, async () => {
      const f = await fixture();
      let finish!: (value: { success: boolean; gatewayTransactionId?: string; errorCode?: string }) => void;
      let entered!: () => void;
      const started = new Promise<void>(resolve => { entered = resolve; });
      const result = new Promise<{ success: boolean; gatewayTransactionId?: string; errorCode?: string }>(resolve => { finish = resolve; });
      const gateway = { charge: vi.fn(() => { entered(); return result; }) };
      const payments = new PaymentsService(new PaymentsRepository(prisma as never), orders, gateway as never, prisma as never);
      const pending = payments.processPayment(f.params);
      try {
        await started;
        // Another key cannot charge the same order while gateway I/O is running.
        await expect(payments.processPayment({ ...f.params, idempotencyKey: randomUUID() })).rejects.toMatchObject({ response: { code: 'PAYMENT_IN_PROGRESS' } });
        await f.expire();
        await job().handleExpiredOrders();
        const during = await f.state();
        expect(during.order.status).toBe('PENDING');
        expect(during.reservation.status).toBe('ACTIVE');
        expect(during.coupon.status).toBe('RESERVED');
        expect(during.stock.stockQuantity).toBe(10);
        expect(await promotionsRepo.countTotalRedemptions(f.coupon.id, new Date())).toBe(1);
        expect(await promotionsRepo.countRedemptions(f.coupon.id, f.user.id, new Date())).toBe(1);
      } finally {
        finish(success ? { success, gatewayTransactionId: `GW-TTL-${randomUUID()}` } : { success, errorCode: 'DECLINED' });
      }
      expect(await pending).toMatchObject({ success, status: success ? 'SUCCEEDED' : 'FAILED' });
      await job().handleExpiredOrders();
      const after = await f.state();
      expect(after.order.status).toBe(success ? 'PAID' : 'CANCELLED');
      expect(after.reservation.status).toBe(success ? 'CONSUMED' : 'EXPIRED');
      expect(after.coupon.status).toBe(success ? 'CONSUMED' : 'EXPIRED');
      expect(after.stock.stockQuantity).toBe(success ? 10 : 20);
      expect(await payments.processPayment(f.params)).toMatchObject({ success, isRetried: true });
      expect(gateway.charge).toHaveBeenCalledTimes(1);
    });
  }

  it('rejects an expired order before contacting the gateway', async () => {
    const f = await fixture('PAYMENT_FAILED');
    await f.expire();
    const gateway = { charge: vi.fn() };
    const payments = new PaymentsService(new PaymentsRepository(prisma as never), orders, gateway as never, prisma as never);
    await expect(payments.processPayment(f.params)).rejects.toMatchObject({ response: { code: 'ORDER_EXPIRED' } });
    await job().handleExpiredOrders();
    await expect(payments.processPayment(f.params)).rejects.toMatchObject({ response: { code: 'ORDER_INVALID_TRANSITION' } });
    expect(gateway.charge).not.toHaveBeenCalled();
    expect(await prisma.payment.count({ where: { orderId: f.order.id } })).toBe(0);
  });

  it('rejects coupon validation and locked quotation at its exact expiry', async () => {
    const f = await fixture();
    await expect(promotions.validateCoupon(f.coupon.code, 40000, f.user.id, f.coupon.endsAt)).rejects.toMatchObject({ status: 422 });
    await expect(prisma.$transaction(tx => promotions.quoteAndLock(tx, f.user.id, f.coupon.code, 40000n, f.coupon.endsAt))).rejects.toMatchObject({ status: 422 });
  });
  it('repairs a reservation later than the expired order TTL and cleans up once', async () => {
    const f = await fixture();
    await prisma.order.update({ where: { id: f.order.id }, data: { reservationExpiresAt: new Date(Date.now() - 1000) } });
    await job().handleExpiredOrders();
    const first = await f.state();
    expect(first.order.status).toBe('CANCELLED');
    expect(first.reservation.status).toBe('EXPIRED');
    expect(first.stock.stockQuantity).toBe(20);
    expect(first.coupon.status).toBe('EXPIRED');
    await job().handleExpiredOrders();
    expect(await f.state()).toEqual(first);
  });

  it('keeps the order TTL authoritative when the reservation expires earlier', async () => {
    const f = await fixture();
    await prisma.inventoryReservation.updateMany({ where: { orderId: f.order.id }, data: { expiresAt: new Date(0) } });
    await job().handleExpiredOrders();
    expect((await f.state()).order.status).toBe('PENDING');
    expect((await f.state()).stock.stockQuantity).toBe(10);
    await f.expire();
    await job().handleExpiredOrders();
    const first = await f.state();
    expect(first.order.status).toBe('CANCELLED');
    expect(first.reservation.status).toBe('EXPIRED');
    expect(first.stock.stockQuantity).toBe(20);
    expect(first.coupon.status).toBe('EXPIRED');
  });


  async function createVnpayPayment(orderId: string, amount: bigint) {
    return prisma.payment.create({
      data: {
        orderId,
        idempotencyKey: randomUUID(),
        requestHash: 'a'.repeat(64),
        method: 'VNPAY',
        status: 'PROCESSING',
        amount,
        gatewayReference: randomUUID().replaceAll('-', ''),
        paymentUrl: 'https://sandbox.vnpayment.vn/paymentv2/vpcpay.html',
      },
    });
  }

  it.each([
    { mode: 'test', cancelled: false },
    { mode: 'test', cancelled: true },
    { mode: 'production', cancelled: false },
  ])('handles a signed Sandbox Return after expiry ($mode, cancelled=$cancelled)', async ({ mode, cancelled }) => {
    const hosted = mode === 'production';
    const frontendOrigin = hosted ? 'https://brew.example' : 'http://localhost:3000';
    const apiOrigin = hosted ? 'https://api.brew.example' : 'http://localhost:3001';
    const config = loadAppConfig({
      NODE_ENV: mode,
      JWT_SECRET: 'test-only-isolated-jwt-secret',
      VNPAY_ENABLED: 'true',
      WEB_ORIGIN: frontendOrigin,
      VNPAY_RETURN_URL: `${apiOrigin}/api/v1/payments/vnpay/return`,
      VNPAY_IPN_URL: 'https://example.invalid/api/v1/payments/vnpay/ipn',
      VNPAY_TMN_CODE: 'TEST0001',
      VNPAY_HASH_SECRET: '0123456789abcdef0123456789abcdef',
    });
    const payments = new PaymentsService(
      new PaymentsRepository(prisma as never), orders, {} as never, prisma as never, new VnpayGatewayService(config),
    );
    const f = await fixture();
    const payment = await createVnpayPayment(f.order.id, f.params.amount);
    await f.expire();
    await job().handleExpiredOrders();

    if (cancelled) {
      await orders.cancelOrder(f.order.id, f.user.id, 'Customer cancellation', false);
      await expect(orders.cancelOrder(f.order.id, f.user.id, 'Customer cancellation retry', false))
        .rejects.toMatchObject({ response: { code: 'ORDER_INVALID_TRANSITION' } });
      expect((await prisma.payment.findUniqueOrThrow({ where: { id: payment.id } })).status).toBe('FAILED');
    }

    const params = new URLSearchParams({
      vnp_TxnRef: payment.gatewayReference!,
      vnp_Amount: (payment.amount * 100n).toString(),
      vnp_TmnCode: config.vnpay.tmnCode!,
      vnp_ResponseCode: '00',
      vnp_TransactionStatus: '00',
      vnp_TransactionNo: randomUUID().replaceAll('-', ''),
    });
    params.sort();
    const callback = Object.fromEntries(params);
    await payments.getVnpayReturnRedirect({ ...callback, vnp_SecureHash: '0'.repeat(128) });
    expect((await f.state()).order.status).toBe(cancelled ? 'CANCELLED' : 'PENDING');
    const signed = {
      ...callback,
      vnp_SecureHash: createHmac('sha512', config.vnpay.hashSecret!).update(params.toString()).digest('hex'),
    };
    await expect(payments.getVnpayReturnRedirect(signed)).resolves.toBe(`${frontendOrigin}/checkout?paymentReturn=1`);
    expect((await f.state()).order.status).toBe(cancelled ? 'CANCELLED' : 'PAID');
    expect((await payments.handleVnpayIpn(signed)).RspCode).toBe('02');

    const state = await f.state();
    expect(state.order.status).toBe(cancelled ? 'CANCELLED' : 'PAID');
    expect(state.reservation.status).toBe(cancelled ? 'EXPIRED' : 'CONSUMED');
    expect(state.coupon.status).toBe(cancelled ? 'EXPIRED' : 'CONSUMED');
    expect(state.stock.stockQuantity).toBe(cancelled ? 20 : 10);
    expect(state.cancellations).toBe(cancelled ? 1 : 0);
    expect((await prisma.payment.findUniqueOrThrow({ where: { id: payment.id } })).status)
      .toBe(cancelled ? 'MANUAL_REVIEW' : 'SUCCEEDED');
    expect(await prisma.loyaltyTransaction.count({ where: { orderId: f.order.id } })).toBe(cancelled ? 0 : 1);
  });

  function recoveryService(query: ReturnType<typeof vi.fn>) {
    return new PaymentRecoveryService(
      prisma as never,
      orders,
      { query } as never,
      { vnpay: { queryServerIp: '203.0.113.10' } } as never,
    );
  }

  const successfulInquiry = (gatewayReference: string) => ({
    requestId: 'query-recovery-123',
    gatewayReference,
    status: 'SUCCESS',
    responseCode: '00',
    transactionStatus: '00',
    transactionNo: randomUUID().replaceAll('-', ''),
    payDate: '20261104030000',
  });

  it('does not release inventory or coupon when an expired Order still has an UNKNOWN PROCESSING Payment', async () => {
    const f = await fixture();
    const payment = await createVnpayPayment(f.order.id, f.params.amount);
    await f.expire();

    const inquiry = vi.fn().mockRejectedValue(new Error('provider timeout after possible charge'));
    const result = await recoveryService(inquiry).recover({
      paymentId: payment.id,
      idempotencyKey: 'recovery-unknown-1',
      incidentReference: 'INC-UNKNOWN-1',
      actorUserId: f.user.id,
    });

    expect(result).toMatchObject({ status: 'UNKNOWN', paymentStatus: 'PROCESSING' });
    await job().handleExpiredOrders();
    const state = await f.state();
    expect(state.order.status).toBe('PENDING');
    expect(state.reservation.status).toBe('ACTIVE');
    expect(state.coupon.status).toBe('RESERVED');
    expect(state.stock.stockQuantity).toBe(10);
    expect((await prisma.payment.findUniqueOrThrow({ where: { id: payment.id } })).status).toBe('PROCESSING');
  });

  it('Tuần tự hóa khôi phục đồng thời và ghi nhận giao dịch đúng một lần', async () => {
    const f = await fixture();
    const payment = await createVnpayPayment(f.order.id, f.params.amount);
    let signalEntered!: () => void;
    let releaseQuery!: (value: ReturnType<typeof successfulInquiry>) => void;
    const entered = new Promise<void>(resolve => { signalEntered = resolve; });
    const pendingResult = new Promise<ReturnType<typeof successfulInquiry>>(resolve => { releaseQuery = resolve; });
    const inquiry = vi.fn(async () => {
      signalEntered();
      return pendingResult;
    });
    const service = recoveryService(inquiry);

    const first = service.recover({
      paymentId: payment.id,
      idempotencyKey: 'recovery-concurrent-1',
      incidentReference: 'INC-CONCURRENT-1',
      actorUserId: f.user.id,
    });
    await entered;

    await expect(service.recover({
      paymentId: payment.id,
      idempotencyKey: 'recovery-concurrent-2',
      incidentReference: 'INC-CONCURRENT-1',
      actorUserId: f.user.id,
    })).rejects.toMatchObject({ status: 409 });

    releaseQuery(successfulInquiry(payment.gatewayReference!));
    const result = await first;
    expect(result).toMatchObject({ status: 'COMPLETED', paymentStatus: 'SUCCEEDED' });
    expect(inquiry).toHaveBeenCalledTimes(1);
    const state = await f.state();
    expect(state.order.status).toBe('PAID');
    expect(state.reservation.status).toBe('CONSUMED');
    expect(state.coupon.status).toBe('CONSUMED');
    expect(state.stock.stockQuantity).toBe(10);
    expect(await prisma.paymentRecoveryAudit.count({ where: { paymentId: payment.id } })).toBe(2);
  });

  it('settles a late provider SUCCESS while the order still holds its reservations', async () => {
    const f = await fixture();
    const payment = await createVnpayPayment(f.order.id, f.params.amount);
    await f.expire();
    const inquiry = vi.fn().mockResolvedValue(successfulInquiry(payment.gatewayReference!));

    const result = await recoveryService(inquiry).recover({
      paymentId: payment.id,
      idempotencyKey: 'recovery-late-success',
      incidentReference: 'INC-LATE-1',
      actorUserId: f.user.id,
    });

    expect(result).toMatchObject({ status: 'COMPLETED', paymentStatus: 'SUCCEEDED' });
    await job().handleExpiredOrders();
    const state = await f.state();
    expect(state.order.status).toBe('PAID');
    expect(state.reservation.status).toBe('CONSUMED');
    expect(state.coupon.status).toBe('CONSUMED');
    expect(state.stock.stockQuantity).toBe(10);
    expect((await prisma.payment.findUniqueOrThrow({ where: { id: payment.id } })).status).toBe('SUCCEEDED');
  });

  it('persists audit after a rolled-back settlement and rejects audit UPDATE/DELETE in PostgreSQL', async () => {
    const f = await fixture();
    const payment = await createVnpayPayment(f.order.id, f.params.amount);
    vi.spyOn(orders, 'markOrderPaid').mockRejectedValueOnce(new Error('force transaction rollback'));
    const inquiry = vi.fn().mockResolvedValue(successfulInquiry(payment.gatewayReference!));

    const result = await recoveryService(inquiry).recover({
      paymentId: payment.id,
      idempotencyKey: 'recovery-rollback-audit',
      incidentReference: 'INC-ROLLBACK-1',
      actorUserId: f.user.id,
    });

    expect(result).toMatchObject({ status: 'UNKNOWN', errorCode: 'SETTLEMENT_ROLLED_BACK' });
    expect((await prisma.payment.findUniqueOrThrow({ where: { id: payment.id } })).status).toBe('PROCESSING');
    const audits = await prisma.paymentRecoveryAudit.findMany({
      where: { paymentId: payment.id },
      orderBy: { createdAt: 'asc' },
    });
    expect(audits.map(row => row.providerOutcome)).toEqual(['RECOVERY_REQUESTED', 'SETTLEMENT_ROLLED_BACK']);
    await expect(prisma.paymentRecoveryAudit.update({
      where: { id: audits[0].id },
      data: { providerOutcome: 'FORGED' },
    })).rejects.toThrow(/append-only/);
    await expect(prisma.paymentRecoveryAudit.delete({
      where: { id: audits[0].id },
    })).rejects.toThrow(/append-only/);
    expect(await prisma.paymentRecoveryAudit.count({ where: { paymentId: payment.id } })).toBe(2);
  });



  it('requires a second operator to confirm refund, persists resolution and releases expired resources once', async () => {
    const f = await fixture();
    const operator = await prisma.user.create({
      data: { username: `operator-${randomUUID()}`, passwordHash: 'test-only', role: 'PAYMENT_OPERATOR' },
    });
    const payment = await createVnpayPayment(f.order.id, f.params.amount);
    await f.expire();
    const inquiry = vi.fn().mockResolvedValue({
      ...successfulInquiry(payment.gatewayReference!), status: 'MANUAL_REVIEW', transactionStatus: '07',
    });
    const service = recoveryService(inquiry);
    const review = await service.recover({
      paymentId: payment.id, idempotencyKey: 'recovery-refund-review',
      incidentReference: 'INC-REFUND-2026', actorUserId: f.user.id,
    });
    expect(review.paymentStatus).toBe('MANUAL_REVIEW');
    const resolutionInput = {
      paymentId: payment.id, idempotencyKey: 'resolution-refund-confirmed',
      decision: 'REFUND_CONFIRMED' as const,
      evidenceReference: 'VN-REFUND-2026-0001', incidentReference: 'INC-REFUND-2026',
    };
    await expect(service.resolveManualReview({ ...resolutionInput, actorUserId: f.user.id }))
      .rejects.toMatchObject({ response: { code: 'SECOND_OPERATOR_REQUIRED' } });
    const resolved = await service.resolveManualReview({ ...resolutionInput, actorUserId: operator.id });
    expect(resolved).toMatchObject({ paymentStatus: 'REFUNDED', decision: 'REFUND_CONFIRMED', isRetried: false });
    expect((await prisma.payment.findUniqueOrThrow({ where: { id: payment.id } })).status).toBe('REFUNDED');
    expect((await prisma.order.findUniqueOrThrow({ where: { id: f.order.id } })).status).toBe('PAYMENT_FAILED');
    const replay = await service.resolveManualReview({ ...resolutionInput, actorUserId: operator.id });
    expect(replay).toMatchObject({ resolutionId: resolved.resolutionId, isRetried: true });
    expect(await prisma.paymentRecoveryResolution.count({ where: { paymentId: payment.id } })).toBe(1);
    await job().handleExpiredOrders();
    const state = await f.state();
    expect(state.order.status).toBe('CANCELLED');
    expect(state.reservation.status).toBe('EXPIRED');
    expect(state.coupon.status).toBe('EXPIRED');
    expect(state.stock.stockQuantity).toBe(20);
    const resolution = await prisma.paymentRecoveryResolution.findFirstOrThrow({ where: { paymentId: payment.id } });
    await expect(prisma.paymentRecoveryResolution.update({
      where: { id: resolution.id }, data: { evidenceReference: 'FORGED' },
    })).rejects.toThrow(/append-only/);
    await expect(prisma.paymentRecoveryResolution.delete({
      where: { id: resolution.id },
    })).rejects.toThrow(/append-only/);
  });

});
