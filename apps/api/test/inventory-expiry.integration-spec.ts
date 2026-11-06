import { PrismaPg } from '@prisma/adapter-pg';
import { randomUUID } from 'node:crypto';
import { PrismaClient } from '../src/generated/prisma/client.js';
import { PromotionsRepository } from '../src/modules/promotions/repositories/promotions.repository.js';
import { InventoryRepository } from '../src/modules/inventory/repositories/inventory.repository.js';
import { InventoryService } from '../src/modules/inventory/services/inventory.service.js';

import { OrdersRepository } from '../src/modules/orders/repositories/orders.repository.js';
import { OrderExpiryJob } from '../src/modules/orders/services/order-expiry.job.js';

import { PromotionsService } from '../src/modules/promotions/services/promotions.service.js';

const connectionString = process.env.SMOKE_DATABASE_URL;

if (
  !connectionString ||
  !new URL(connectionString).pathname
    .slice(1)
    .startsWith('brewlite_foundation_smoke')
) {
  throw new Error(
    'Set SMOKE_DATABASE_URL to the disposable BrewLite smoke database',
  );
}

describe('SD-13 order-owned expiry lifecycle', () => {
  const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString }),
  });

  const inventoryRepository = new InventoryRepository({} as never);
  const ordersRepository = new OrdersRepository(prisma as never);

  const inventoryService = new InventoryService(
    prisma as never,
    inventoryRepository,
  );

  const promotionsRepository = new PromotionsRepository(prisma as never);
  const promotionsService = new PromotionsService(promotionsRepository);

  const expiryJob = new OrderExpiryJob(
    prisma as never,
    ordersRepository,
    inventoryService,
    promotionsService,
  );

  beforeAll(async () => {
    await prisma.$connect();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('expires overdue reservations and restores stock exactly once', async () => {
    const user = await prisma.user.create({
      data: {
        username: `expiry-job-${randomUUID()}`,
        passwordHash: 'integration-test-only',
      },
    });

    // Mỗi ly dùng 10g; kho có 20g nên làm được tối đa 2 ly.
    const ingredient = await prisma.ingredient.create({
      data: {
        code: `EXPJOB-BEAN-${randomUUID()}`,
        name: 'Expiry job coffee beans',
        unit: 'G',
        stockQuantity: 20,
      },
    });

    const product = await prisma.product.create({
      data: {
        sku: `EXPJOB-${randomUUID()}`,
        name: 'Expiry job integration product',
        imageUrl: '/expiry-job-test.png',
        variants: {
          create: {
            size: 'M',
            price: 40000n,
            recipeItems: {
              create: { ingredientId: ingredient.id, quantity: 10 },
            },
          },
        },
      },
      include: {
        variants: true,
      },
    });

    const variant = product.variants[0];

    if (!variant) {
      throw new Error('Product variant was not created');
    }

    const futureExpiry = new Date(Date.now() + 15 * 60 * 1000);

    const order = await prisma.order.create({
      data: {
        orderNumber: `EXPJOB-${randomUUID().slice(0, 8)}`,
        userId: user.id,
        subtotal: 40000n,
        total: 40000n,
        reservationExpiresAt: futureExpiry,
        items: {
          create: {
            productVariantId: variant.id,
            productNameSnapshot: product.name,
            variantNameSnapshot: 'M',
            unitPrice: 40000n,
            quantity: 1,
          },
        },
        statusHistories: {
          create: {
            toStatus: 'PENDING',
          },
        },
      },
    });
    // Tạo coupon thật trong database để kiểm tra job giải phóng coupon.
const coupon = await prisma.coupon.create({
  data: {
    code: `EXPJOB-${randomUUID()}`,
    discountType: 'FIXED_AMOUNT',
    discountValue: 5000n,
    startsAt: new Date(Date.now() - 24 * 60 * 60 * 1000),
    endsAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
  },
});

// Gắn coupon với đơn hàng bằng trạng thái RESERVED.
const couponRedemption = await prisma.couponRedemption.create({
  data: {
    couponId: coupon.id,
    userId: user.id,
    orderId: order.id,
    discountAmount: 5000n,
    status: 'RESERVED',
    expiresAt: futureExpiry,
  },
});

    const reservations = await prisma.$transaction((tx) =>
      inventoryService.reserve(
        tx,
        order.id,
        [
          {
            productVariantId: variant.id,
            quantity: 1,
          },
        ],
        futureExpiry,
      ),
    );

    const reservation = reservations[0];

    if (!reservation) {
      throw new Error('Inventory reservation was not created');
    }

    // Đưa cả đơn hàng và reservation về trạng thái quá hạn.
    // Job kiểm tra reservationExpiresAt của đơn hàng.
    const expiredAt = new Date(Date.now() - 60 * 1000);

    await prisma.inventoryReservation.update({
      where: {
        id: reservation.id,
      },
      data: {
        expiresAt: expiredAt,
      },
    });

    await prisma.order.update({
      where: { id: order.id },
      data: { reservationExpiresAt: expiredAt },
    });

    const stockAfterReserve = await prisma.ingredient.findUniqueOrThrow({
      where: { id: ingredient.id },
    });

    expect(stockAfterReserve.stockQuantity).toBe(10);
    expect(stockAfterReserve.version).toBe(1);

    // Chạy job lần thứ nhất.
    await expiryJob.handleExpiredOrders();
    // Kiểm tra coupon đã được giải phóng trong database.
    const expiredCouponRedemption =
  await prisma.couponRedemption.findUniqueOrThrow({
    where: {
      id: couponRedemption.id,
    },
  });

expect(expiredCouponRedemption.status).toBe('EXPIRED');
expect(expiredCouponRedemption.releasedAt).not.toBeNull();

    const expiredReservation =
      await prisma.inventoryReservation.findUniqueOrThrow({
        where: {
          id: reservation.id,
        },
      });

    const stockAfterExpiry = await prisma.ingredient.findUniqueOrThrow({
      where: { id: ingredient.id },
    });

    expect(expiredReservation.status).toBe('EXPIRED');
    expect(stockAfterExpiry.stockQuantity).toBe(20);
    expect(stockAfterExpiry.version).toBe(2);

    // Chạy lại job: reservation đã EXPIRED nên không được hoàn nguyên liệu lần nữa.
    await expiryJob.handleExpiredOrders();
    


    const stockAfterSecondRun = await prisma.ingredient.findUniqueOrThrow({
      where: { id: ingredient.id },
    });

    expect(stockAfterSecondRun.stockQuantity).toBe(20);
    expect(stockAfterSecondRun.version).toBe(2);
    // Chạy job lần hai không được xử lý lại coupon.
const couponAfterSecondRun =
  await prisma.couponRedemption.findUniqueOrThrow({
    where: {
      id: couponRedemption.id,
    },
  });

expect(couponAfterSecondRun.status).toBe('EXPIRED');
expect(couponAfterSecondRun.releasedAt).toEqual(
  expiredCouponRedemption.releasedAt,
);
  });

  it('keeps an in-flight payment alive, then expires PAYMENT_FAILED order coupon and inventory together', async () => {
    // Chuẩn bị user, món và coupon để kiểm tra vòng đời Order/Payment/Promotion/Inventory.
    const user = await prisma.user.create({
      data: {
        username: `expiry-coupon-${randomUUID()}`,
        passwordHash: 'integration-test-only',
      },
    });

    // Mỗi ly sử dụng 10g nguyên liệu; kho ban đầu có 20g.
    const ingredient = await prisma.ingredient.create({
      data: {
        code: `EXP-${randomUUID()}`,
        name: 'Expiry coupon coffee beans',
        unit: 'G',
        stockQuantity: 20,
      },
    });

    const product = await prisma.product.create({
      data: {
        sku: `EXPCOUPON-${randomUUID()}`,
        name: 'Expiry coupon integration product',
        imageUrl: '/expiry-coupon-test.png',
        variants: {
          create: {
            size: 'M',
            price: 40000n,
            recipeItems: {
              create: {
                ingredientId: ingredient.id,
                quantity: 10,
              },
            },
          },
        },
      },
      include: { variants: true },
    });

    const variant = product.variants[0];
    if (!variant) throw new Error('Product variant was not created');

    const futureExpiry = new Date(Date.now() + 15 * 60 * 1000);
    const promotion = await prisma.coupon.create({
      data: {
        code: `EXPCOUPON-${randomUUID()}`,
        discountType: 'FIXED_AMOUNT',
        discountValue: 5000n,
        startsAt: new Date(Date.now() - 60_000),
        endsAt: new Date(Date.now() + 60 * 60 * 1000),
        usageLimit: 1,
        perUserLimit: 1,
      },
    });

    const order = await prisma.order.create({
      data: {
        orderNumber: `EXPCOUPON-${randomUUID().slice(0, 8)}`,
        userId: user.id,
        subtotal: 40000n,
        discountAmount: 5000n,
        total: 35000n,
        couponCodeSnapshot: promotion.code,
        reservationExpiresAt: futureExpiry,
        items: {
          create: {
            productVariantId: variant.id,
            productNameSnapshot: product.name,
            variantNameSnapshot: 'M',
            unitPrice: 40000n,
            quantity: 1,
          },
        },
        statusHistories: { create: { toStatus: 'PENDING' } },
      },
    });

    const reservations = await prisma.$transaction((tx) =>
      inventoryService.reserve(
        tx,
        order.id,
        [{ productVariantId: variant.id, quantity: 1 }],
        futureExpiry,
      ),
    );
    const reservation = reservations[0];
    if (!reservation) throw new Error('Inventory reservation was not created');

    const redemption = await prisma.couponRedemption.create({
      data: {
        couponId: promotion.id,
        userId: user.id,
        orderId: order.id,
        discountAmount: 5000n,
        expiresAt: futureExpiry,
      },
    });

    // Payment đã PROCESSING nghĩa là khách bắt đầu thanh toán khi reservation còn hạn.
    const payment = await prisma.payment.create({
      data: {
        orderId: order.id,
        idempotencyKey: `expiry-processing-${randomUUID()}`,
        requestHash: 'a'.repeat(64),
        method: 'CARD',
        status: 'PROCESSING',
        amount: 35000n,
      },
    });

    // Đẩy thời điểm hết hạn về quá khứ để mô phỏng Gateway phản hồi sau mốc giữ chỗ.
    const expiredAt = new Date(Date.now() - 60_000);
    await prisma.order.update({
      where: { id: order.id },
      data: { reservationExpiresAt: expiredAt },
    });
    await prisma.inventoryReservation.update({
      where: { id: reservation.id },
      data: { expiresAt: expiredAt },
    });
    await prisma.couponRedemption.update({
      where: { id: redemption.id },
      data: { expiresAt: expiredAt },
    });

    // Job không được hủy đơn hay giải phóng Coupon trong khi Payment còn PROCESSING.
    await expiryJob.handleExpiredOrders();
    expect(await prisma.order.findUniqueOrThrow({ where: { id: order.id } }))
      .toMatchObject({ status: 'PENDING' });
    expect(await prisma.couponRedemption.findUniqueOrThrow({ where: { id: redemption.id } }))
      .toMatchObject({ status: 'RESERVED' });
    expect(await prisma.inventoryReservation.findUniqueOrThrow({ where: { id: reservation.id } }))
      .toMatchObject({ status: 'ACTIVE' });
    expect(
      await prisma.ingredient.findUniqueOrThrow({
        where: { id: ingredient.id },
      }),
    ).toMatchObject({
      stockQuantity: 10,
      version: 1,
    });

    // Khi Gateway trả FAILED, Order trở thành PAYMENT_FAILED và có thể hết hạn an toàn.
    await prisma.$transaction(async (tx) => {
      await tx.payment.update({
        where: { id: payment.id },
        data: {
          status: 'FAILED',
          failureCode: 'INSUFFICIENT_FUNDS',
          processedAt: new Date(),
        },
      });
      await tx.order.update({
        where: { id: order.id },
        data: { status: 'PAYMENT_FAILED' },
      });
      await tx.orderStatusHistory.create({
        data: {
          orderId: order.id,
          fromStatus: 'PENDING',
          toStatus: 'PAYMENT_FAILED',
          changedByUserId: user.id,
          reason: 'Gateway từ chối thanh toán',
        },
      });
    });

    // Job phải hủy Order, chuyển coupon sang EXPIRED và hoàn kho trong một transaction.
    await expiryJob.handleExpiredOrders();
    expect(await prisma.order.findUniqueOrThrow({ where: { id: order.id } }))
      .toMatchObject({ status: 'CANCELLED' });
    expect(await prisma.couponRedemption.findUniqueOrThrow({ where: { id: redemption.id } }))
      .toMatchObject({ status: 'EXPIRED', releasedAt: expect.any(Date) });
    expect(await prisma.inventoryReservation.findUniqueOrThrow({ where: { id: reservation.id } }))
      .toMatchObject({ status: 'EXPIRED' });

    expect(
      await prisma.ingredient.findUniqueOrThrow({
        where: { id: ingredient.id },
      }),
    ).toMatchObject({
      stockQuantity: 20,
      version: 2,
    });

    // Chạy lặp không được hoàn kho hoặc giải phóng Coupon thêm lần nữa.
    await expiryJob.handleExpiredOrders();

        expect(
      await prisma.ingredient.findUniqueOrThrow({
        where: { id: ingredient.id },
      }),
    ).toMatchObject({
      stockQuantity: 20,
      version: 2,
    });

    expect(await prisma.couponRedemption.findUniqueOrThrow({ where: { id: redemption.id } }))
      .toMatchObject({ status: 'EXPIRED' });
  });

});
