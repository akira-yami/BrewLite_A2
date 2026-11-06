import { ConflictException } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { OrderStatus, PaymentStatus } from '../../../generated/prisma/client.js';
import { OrderExpiryJob } from './order-expiry.job.js';

function setup() {
  const tx = {
    payment: { findFirst: vi.fn().mockResolvedValue(null) },
    inventoryReservation: {
      findMany: vi.fn().mockResolvedValue([]),
      update: vi.fn(),
    },
  };
  const prisma = {
    order: { findMany: vi.fn().mockResolvedValue([]) },
    $transaction: vi.fn(async (callback: (client: typeof tx) => unknown) =>
      callback(tx),
    ),
  };
  const ordersRepo = {
    findByIdForUpdate: vi.fn(),
    updateStatusWithHistory: vi.fn(),
  };
  const inventoryService = {
    releaseInTransaction: vi.fn(),
  };
  const promotionsService = {
    releaseRedemption: vi.fn(),
  };

  const job = new OrderExpiryJob(
    prisma as any,
    ordersRepo as any,
    inventoryService as any,
    promotionsService as any,
  );

  return {
    job,
    prisma,
    tx,
    ordersRepo,
    inventoryService,
    promotionsService,
  };
}

describe('OrderExpiryJob', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('queries overdue PENDING/PAYMENT_FAILED orders without PROCESSING payments', async () => {
    const { job, prisma } = setup();

    await job.handleExpiredOrders();

    expect(prisma.order.findMany).toHaveBeenCalledWith({
      where: {
        status: { in: [OrderStatus.PENDING, OrderStatus.PAYMENT_FAILED] },
        reservationExpiresAt: { lte: expect.any(Date) },
        payments: { none: { status: { in: [PaymentStatus.PROCESSING, PaymentStatus.MANUAL_REVIEW] } } },
      },
      select: { id: true, userId: true, status: true },
    });
  });

  it('does not start a second run while the current scan is still pending', async () => {
    const { job, prisma } = setup();
    let finishScan!: (orders: never[]) => void;
    const pendingScan = new Promise<never[]>((resolve) => {
      finishScan = resolve;
    });
    prisma.order.findMany.mockReturnValue(pendingScan);

    const firstRun = job.handleExpiredOrders();
    await job.handleExpiredOrders();

    expect(prisma.order.findMany).toHaveBeenCalledTimes(1);

    finishScan([]);
    await firstRun;
  });

  it('cancels an expired order, releases its coupon and expires every active inventory reservation', async () => {
    const {
      job,
      prisma,
      tx,
      ordersRepo,
      inventoryService,
      promotionsService,
    } = setup();
    const order = {
      id: 'order-expired',
      userId: 'user-1',
      status: OrderStatus.PENDING,
    };
    const orderDeadline = new Date(Date.now() - 60_000);
    ordersRepo.findByIdForUpdate.mockResolvedValue({
      ...order,
      reservationExpiresAt: orderDeadline,
    });
    tx.inventoryReservation.findMany.mockResolvedValue([
      { id: 'reservation-1', expiresAt: new Date(Date.now() + 60_000) },
      { id: 'reservation-2', expiresAt: new Date(Date.now() - 120_000) },
    ]);
    prisma.order.findMany.mockResolvedValue([order]);

    await job.handleExpiredOrders();

    expect(ordersRepo.findByIdForUpdate).toHaveBeenCalledWith(
      order.id,
      tx,
    );
    expect(tx.payment.findFirst).toHaveBeenCalledWith({
      where: {
        orderId: order.id,
        status: { in: [PaymentStatus.PROCESSING, PaymentStatus.MANUAL_REVIEW] },
      },
      select: { id: true },
    });
    expect(ordersRepo.updateStatusWithHistory).toHaveBeenCalledWith(
      order.id,
      OrderStatus.PENDING,
      OrderStatus.CANCELLED,
      order.userId,
      expect.stringContaining(order.id),
      tx,
    );
    expect(promotionsService.releaseRedemption).toHaveBeenCalledWith(
      tx,
      order.id,
      true,
    );
    expect(tx.inventoryReservation.findMany).toHaveBeenCalledWith({
      where: { orderId: order.id, status: 'ACTIVE' },
      select: { id: true, expiresAt: true },
    });
    expect(tx.inventoryReservation.update).toHaveBeenCalledTimes(1);
    expect(tx.inventoryReservation.update).toHaveBeenCalledWith({
      where: { id: 'reservation-1' },
      data: { expiresAt: orderDeadline },
    });
    expect(inventoryService.releaseInTransaction).toHaveBeenNthCalledWith(
      1,
      tx,
      'reservation-1',
      true,
    );
    expect(inventoryService.releaseInTransaction).toHaveBeenNthCalledWith(
      2,
      tx,
      'reservation-2',
      true,
    );
  });

  it.each([
    ['order no longer exists', null],
    [
      'order has already moved to PAID',
      {
        id: 'order-1',
        userId: 'user-1',
        status: OrderStatus.PAID,
        reservationExpiresAt: new Date(Date.now() - 60_000),
      },
    ],
    [
      'reservation has not expired yet',
      {
        id: 'order-1',
        userId: 'user-1',
        status: OrderStatus.PENDING,
        reservationExpiresAt: new Date(Date.now() + 60_000),
      },
    ],
  ])('skips the transaction when %s', async (_case, lockedOrder) => {
    const { job, prisma, tx, ordersRepo, promotionsService } = setup();
    prisma.order.findMany.mockResolvedValue([
      { id: 'order-1', userId: 'user-1', status: OrderStatus.PENDING },
    ]);
    ordersRepo.findByIdForUpdate.mockResolvedValue(lockedOrder);

    await job.handleExpiredOrders();

    expect(tx.payment.findFirst).not.toHaveBeenCalled();
    expect(ordersRepo.updateStatusWithHistory).not.toHaveBeenCalled();
    expect(promotionsService.releaseRedemption).not.toHaveBeenCalled();
  });

  it('does not expire an order if a PROCESSING payment is found after acquiring the order lock', async () => {
    const { job, prisma, tx, ordersRepo, promotionsService, inventoryService } =
      setup();
    prisma.order.findMany.mockResolvedValue([
      { id: 'order-1', userId: 'user-1', status: OrderStatus.PAYMENT_FAILED },
    ]);
    ordersRepo.findByIdForUpdate.mockResolvedValue({
      id: 'order-1',
      userId: 'user-1',
      status: OrderStatus.PAYMENT_FAILED,
      reservationExpiresAt: new Date(Date.now() - 60_000),
    });
    tx.payment.findFirst.mockResolvedValue({ id: 'payment-processing' });

    await job.handleExpiredOrders();

    expect(tx.payment.findFirst).toHaveBeenCalled();
    expect(ordersRepo.updateStatusWithHistory).not.toHaveBeenCalled();
    expect(promotionsService.releaseRedemption).not.toHaveBeenCalled();
    expect(inventoryService.releaseInTransaction).not.toHaveBeenCalled();
  });

  it('continues scanning after a per-order conflict', async () => {
    const { job, prisma, ordersRepo } = setup();
    prisma.order.findMany.mockResolvedValue([
      { id: 'order-conflict', userId: 'user-1', status: OrderStatus.PENDING },
      { id: 'order-valid', userId: 'user-2', status: OrderStatus.PENDING },
    ]);
    ordersRepo.findByIdForUpdate
      .mockRejectedValueOnce(new ConflictException('concurrent update'))
      .mockResolvedValueOnce({
        id: 'order-valid',
        userId: 'user-2',
        status: OrderStatus.PENDING,
        reservationExpiresAt: new Date(Date.now() - 60_000),
      });

    await expect(job.handleExpiredOrders()).resolves.toBeUndefined();

    expect(ordersRepo.findByIdForUpdate).toHaveBeenCalledTimes(2);
    expect(ordersRepo.updateStatusWithHistory).toHaveBeenCalledTimes(1);
  });

  it('contains an unexpected per-order error and continues with the next order', async () => {
    const { job, prisma, ordersRepo } = setup();
    prisma.order.findMany.mockResolvedValue([
      { id: 'order-error', userId: 'user-1', status: OrderStatus.PENDING },
      { id: 'order-valid', userId: 'user-2', status: OrderStatus.PENDING },
    ]);
    ordersRepo.findByIdForUpdate
      .mockRejectedValueOnce(new Error('database unavailable'))
      .mockResolvedValueOnce({
        id: 'order-valid',
        userId: 'user-2',
        status: OrderStatus.PENDING,
        reservationExpiresAt: new Date(Date.now() - 60_000),
      });

    await expect(job.handleExpiredOrders()).resolves.toBeUndefined();

    expect(ordersRepo.findByIdForUpdate).toHaveBeenCalledTimes(2);
    expect(ordersRepo.updateStatusWithHistory).toHaveBeenCalledTimes(1);
  });

  it('contains a scan error and allows a later run', async () => {
    const { job, prisma } = setup();
    prisma.order.findMany
      .mockRejectedValueOnce(new Error('query failed'))
      .mockResolvedValueOnce([]);

    await expect(job.handleExpiredOrders()).resolves.toBeUndefined();
    await expect(job.handleExpiredOrders()).resolves.toBeUndefined();

    expect(prisma.order.findMany).toHaveBeenCalledTimes(2);
  });

  it('does not release reservations when there are no ACTIVE reservations', async () => {
    const { job, prisma, tx, ordersRepo, inventoryService } = setup();
    prisma.order.findMany.mockResolvedValue([
      { id: 'order-empty', userId: 'user-1', status: OrderStatus.PENDING },
    ]);
    ordersRepo.findByIdForUpdate.mockResolvedValue({
      id: 'order-empty',
      userId: 'user-1',
      status: OrderStatus.PENDING,
      reservationExpiresAt: new Date(Date.now() - 60_000),
    });
    tx.inventoryReservation.findMany.mockResolvedValue([]);

    await job.handleExpiredOrders();

    expect(inventoryService.releaseInTransaction).not.toHaveBeenCalled();
  });
});
