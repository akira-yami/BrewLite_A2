// Kiểm tra vòng đời đơn qua HTTP và PostgreSQL, quyền hủy và hai Barista nhận cùng đơn.
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { AppModule } from '../../src/app.module.js';
import { PrismaService } from '../../src/database/prisma.service.js';
import { OrderStatus } from '../../src/generated/prisma/client.js';
import { OrdersRepository } from '../../src/modules/orders/repositories/orders.repository.js';
import { OrdersService } from '../../src/modules/orders/services/orders.service.js';

const connectionString = process.env.SMOKE_DATABASE_URL;
if (
  !connectionString ||
  !new URL(connectionString).pathname
    .slice(1)
    .startsWith('brewlite_foundation_smoke')
) {
  throw new Error(
    'State machine tests require a disposable brewlite_foundation_smoke* database',
  );
}

describe('Order State Machine: real HTTP and PostgreSQL', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let orders: OrdersService;
  let repository: OrdersRepository;
  let customerId: string;
  let baristaId: string;
  let customerToken: string;
  let baristaToken: string;
  let variantId: string;
  const previousUrl = process.env.DATABASE_URL;

  const bearer = (token: string) => `Bearer ${token}`;
  const advance = (orderId: string, status: string, token = baristaToken) =>
    request(app.getHttpServer())
      .patch(`/api/v1/staff/orders/${orderId}/status`)
      .set('Authorization', bearer(token))
      .send({ status });
  const statusOf = async (id: string) =>
    (await prisma.order.findUniqueOrThrow({ where: { id } })).status;
  const historyOf = async (id: string) =>
    (
      await prisma.orderStatusHistory.findMany({
        where: { orderId: id },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      })
    ).map((row) => `${row.fromStatus ?? 'start'}>${row.toStatus}`);

  /** Tạo đơn PENDING thật qua API đặt đơn của khách. */
  async function newOrder() {
    const response = await request(app.getHttpServer())
      .post('/api/v1/orders')
      .set('Authorization', bearer(customerToken))
      .send({ items: [{ productVariantId: variantId, quantity: 1 }] })
      .expect(201);
    return {
      id: response.body.data.id as string,
      total: BigInt(response.body.data.total),
    };
  }
  /** Đưa đơn sang PAID bằng đúng đường chạy của thanh toán. */
  async function newPaidOrder() {
    const order = await newOrder();
    await prisma.$transaction((tx) =>
      orders.markOrderPaid(order.id, customerId, order.total, tx),
    );
    return order;
  }

  beforeAll(async () => {
    process.env.DATABASE_URL = connectionString;
    const module = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = module.createNestApplication();
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(
      new ValidationPipe({
        transform: true,
        whitelist: true,
        forbidNonWhitelisted: true,
      }),
    );
    await app.init();
    prisma = app.get(PrismaService);
    orders = app.get(OrdersService, { strict: false });
    repository = app.get(OrdersRepository, { strict: false });
    const jwt = app.get(JwtService);

    const [customer, barista] = await Promise.all(
      (['CUSTOMER', 'BARISTA'] as const).map((role) =>
        prisma.user.create({
          data: {
            username: `sm-${randomUUID()}`,
            passwordHash: 'test-only',
            role,
          },
        }),
      ),
    );
    customerId = customer.id;
    baristaId = barista.id;
    customerToken = jwt.sign({
      sub: customer.id,
      role: customer.role,
      username: customer.username,
    });
    baristaToken = jwt.sign({
      sub: barista.id,
      role: barista.role,
      username: barista.username,
    });

    const ingredient = await prisma.ingredient.create({
      data: {
        code: `SM-BEAN-${randomUUID()}`,
        name: 'State machine test beans',
        unit: 'G',
        stockQuantity: 100000,
      },
    });
    const product = await prisma.product.create({
      data: {
        sku: randomUUID(),
        name: 'State machine coffee',
        imageUrl: '/test.png',
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
      include: { variants: true },
    });
    variantId = product.variants[0].id;
  }, 30000);

  afterAll(async () => {
    await app?.close();
    if (previousUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = previousUrl;
  });

  it('luồng chính: PENDING → PAID → PREPARING → READY → COMPLETED, ghi lịch sử và khách thấy được', async () => {
    const order = await newPaidOrder();
    expect(await statusOf(order.id)).toBe('PAID');

    for (const status of ['PREPARING', 'READY', 'COMPLETED'] as const) {
      const response = await advance(order.id, status).expect(200);
      expect(response.body.data.status).toBe(status);
      expect(await statusOf(order.id)).toBe(status);
    }

    expect(await historyOf(order.id)).toEqual([
      'start>PENDING',
      'PENDING>PAID',
      'PAID>PREPARING',
      'PREPARING>READY',
      'READY>COMPLETED',
    ]);
    const baristaRows = await prisma.orderStatusHistory.findMany({
      where: {
        orderId: order.id,
        toStatus: { in: ['PREPARING', 'READY', 'COMPLETED'] },
      },
    });
    expect(baristaRows).toHaveLength(3);
    expect(baristaRows.every((row) => row.changedByUserId === baristaId)).toBe(
      true,
    );

    const detail = await request(app.getHttpServer())
      .get(`/api/v1/orders/${order.id}`)
      .set('Authorization', bearer(customerToken))
      .expect(200);
    expect(detail.body.data.status).toBe('COMPLETED');
    expect(
      detail.body.data.timeline.map(
        (entry: { toStatus: string }) => entry.toStatus,
      ),
    ).toEqual(['PENDING', 'PAID', 'PREPARING', 'READY', 'COMPLETED']);
  });

  // Các bước barista cần đi để đưa một đơn PAID tới từng trạng thái.
  const stepsTo = {
    PAID: [],
    PREPARING: ['PREPARING'],
    READY: ['PREPARING', 'READY'],
    COMPLETED: ['PREPARING', 'READY', 'COMPLETED'],
  } as const;

  it.each([
    ['PAID', 'READY'],
    ['PAID', 'COMPLETED'],
    ['PREPARING', 'PREPARING'],
    ['PREPARING', 'COMPLETED'],
    ['READY', 'PREPARING'],
    ['COMPLETED', 'READY'],
  ] as const)(
    'đơn đang %s: đặt %s bị 409 INVALID_ORDER_TRANSITION, trạng thái và lịch sử không đổi',
    async (current, target) => {
      const order = await newPaidOrder();
      for (const step of stepsTo[current])
        await advance(order.id, step).expect(200);
      expect(await statusOf(order.id)).toBe(current);
      const before = await historyOf(order.id);

      const response = await advance(order.id, target).expect(409);

      expect(response.body.error.code).toBe('INVALID_ORDER_TRANSITION');
      expect(response.body.error.details).toEqual([
        { from: current, to: target },
      ]);
      expect(await statusOf(order.id)).toBe(current);
      expect(await historyOf(order.id)).toEqual(before);
    },
  );

  it('đơn chưa thanh toán (PENDING) không thể nhận', async () => {
    const order = await newOrder();
    const response = await advance(order.id, 'PREPARING').expect(409);
    expect(response.body.error.code).toBe('INVALID_ORDER_TRANSITION');
    expect(await statusOf(order.id)).toBe('PENDING');
  });

  it('nhánh lỗi: PENDING → PAYMENT_FAILED → thử lại PENDING → PAID; PAYMENT_FAILED không thể sang PAID trực tiếp', async () => {
    const order = await newOrder();
    await prisma.$transaction((tx) =>
      orders.markOrderPaymentFailed(order.id, customerId, 'Thẻ bị từ chối', tx),
    );
    expect(await statusOf(order.id)).toBe('PAYMENT_FAILED');

    // Phải thử lại (về PENDING) trước khi thanh toán: PAYMENT_FAILED → PAID bị chặn.
    await expect(
      prisma.$transaction((tx) =>
        orders.markOrderPaid(order.id, customerId, order.total, tx),
      ),
    ).rejects.toBeDefined();
    expect(await statusOf(order.id)).toBe('PAYMENT_FAILED');
    // Barista cũng không nhận được đơn lỗi thanh toán.
    await advance(order.id, 'PREPARING').expect(409);

    await orders.transitionForPaymentRetry(
      order.id,
      customerId,
      'Thử lại thanh toán',
    );
    expect(await statusOf(order.id)).toBe('PENDING');
    await prisma.$transaction((tx) =>
      orders.markOrderPaid(order.id, customerId, order.total, tx),
    );
    expect(await statusOf(order.id)).toBe('PAID');
    expect(await historyOf(order.id)).toEqual([
      'start>PENDING',
      'PENDING>PAYMENT_FAILED',
      'PAYMENT_FAILED>PENDING',
      'PENDING>PAID',
    ]);
  });

  it('nhánh hủy: PENDING, PAYMENT_FAILED và PAID → CANCELLED hợp lệ; CANCELLED là trạng thái kết thúc', async () => {
    const pending = await newOrder();
    await repository.updateStatusWithHistory(
      pending.id,
      OrderStatus.PENDING,
      OrderStatus.CANCELLED,
      customerId,
      'Khách hủy',
    );
    expect(await statusOf(pending.id)).toBe('CANCELLED');

    const failed = await newOrder();
    await prisma.$transaction((tx) =>
      orders.markOrderPaymentFailed(failed.id, customerId, 'lỗi', tx),
    );
    await repository.updateStatusWithHistory(
      failed.id,
      OrderStatus.PAYMENT_FAILED,
      OrderStatus.CANCELLED,
      customerId,
      'Khách hủy',
    );
    expect(await statusOf(failed.id)).toBe('CANCELLED');

    const paid = await newPaidOrder();
    await repository.updateStatusWithHistory(
      paid.id,
      OrderStatus.PAID,
      OrderStatus.CANCELLED,
      baristaId,
      'Hủy đơn đã thanh toán',
    );
    expect(await statusOf(paid.id)).toBe('CANCELLED');

    for (const id of [pending.id, failed.id, paid.id]) {
      for (const target of ['PREPARING', 'READY', 'COMPLETED']) {
        await advance(id, target).expect(409);
      }
      await expect(
        repository.updateStatusWithHistory(
          id,
          OrderStatus.CANCELLED,
          OrderStatus.PENDING,
          customerId,
          'mở lại',
        ),
      ).rejects.toMatchObject({
        response: { error: { code: 'INVALID_ORDER_TRANSITION' } },
      });
      expect(await statusOf(id)).toBe('CANCELLED');
    }
  });

  it('API hủy đơn chưa trả tiền hoàn tồn đúng một lần và kiểm tra chủ đơn', async () => {
    const order = await newOrder();
    const reservation = await prisma.inventoryReservation.findFirstOrThrow({
      where: { orderId: order.id },
      include: { items: true },
    });
    const item = reservation.items[0];
    const before = await prisma.ingredient.findUniqueOrThrow({
      where: { id: item.ingredientId },
    });
    await request(app.getHttpServer())
      .post(`/api/v1/orders/${order.id}/cancel`)
      .expect(401);
    await request(app.getHttpServer())
      .post(`/api/v1/orders/${order.id}/cancel`)
      .set('Authorization', bearer(baristaToken))
      .expect(403);
    const cancelled = await request(app.getHttpServer())
      .post(`/api/v1/orders/${order.id}/cancel`)
      .set('Authorization', bearer(customerToken))
      .expect(200);
    expect(cancelled.body.data.status).toBe('CANCELLED');
    const after = await prisma.ingredient.findUniqueOrThrow({
      where: { id: item.ingredientId },
    });
    expect(after.stockQuantity).toBe(before.stockQuantity + item.quantity);
    await request(app.getHttpServer())
      .post(`/api/v1/orders/${order.id}/cancel`)
      .set('Authorization', bearer(customerToken))
      .expect(409);
    expect(
      (
        await prisma.ingredient.findUniqueOrThrow({
          where: { id: item.ingredientId },
        })
      ).stockQuantity,
    ).toBe(after.stockQuantity);
    const otherOrder = await newOrder();
    const jwt = app.get(JwtService);
    const stranger = await prisma.user.create({
      data: {
        username: randomUUID(),
        passwordHash: 'test-only',
        role: 'CUSTOMER',
      },
    });
    const token = jwt.sign({
      sub: stranger.id,
      role: 'CUSTOMER',
      username: stranger.username,
    });
    await request(app.getHttpServer())
      .post(`/api/v1/orders/${otherOrder.id}/cancel`)
      .set('Authorization', bearer(token))
      .expect(404);
  });

  it('cancellation cannot interrupt a payment admitted to the gateway', async () => {
    const order = await newOrder();
    await prisma.payment.create({
      data: {
        orderId: order.id,
        idempotencyKey: randomUUID(),
        requestHash: 'a'.repeat(64),
        amount: order.total,
        method: 'E_WALLET',
        status: 'PROCESSING',
      },
    });
    const result = await request(app.getHttpServer())
      .post(`/api/v1/orders/${order.id}/cancel`)
      .set('Authorization', bearer(customerToken))
      .expect(409);
    expect(result.body.error.code).toBe('PAYMENT_IN_PROGRESS');
    expect(await statusOf(order.id)).toBe('PENDING');
  });

  it('repository chặn chuyển tiếp sai ngay cả khi không đi qua API barista', async () => {
    const order = await newPaidOrder();
    await expect(
      repository.updateStatusWithHistory(
        order.id,
        OrderStatus.PAID,
        OrderStatus.COMPLETED,
        baristaId,
        'bỏ qua pha chế',
      ),
    ).rejects.toMatchObject({
      response: { error: { code: 'INVALID_ORDER_TRANSITION' } },
    });
    expect(await statusOf(order.id)).toBe('PAID');
    expect(await historyOf(order.id)).toEqual([
      'start>PENDING',
      'PENDING>PAID',
    ]);
  });

  it('hai barista nhận cùng một đơn đồng thời: đúng một người thành công', async () => {
    const order = await newPaidOrder();
    const second = await prisma.user.create({
      data: {
        username: `sm-${randomUUID()}`,
        passwordHash: 'test-only',
        role: 'BARISTA',
      },
    });
    const jwt = app.get(JwtService);
    const secondToken = jwt.sign({
      sub: second.id,
      role: 'BARISTA',
      username: second.username,
    });

    const results = await Promise.all([
      advance(order.id, 'PREPARING'),
      advance(order.id, 'PREPARING', secondToken),
    ]);

    expect(results.map((r) => r.status).sort((a, b) => a - b)).toEqual([200, 409]);
    expect(await statusOf(order.id)).toBe('PREPARING');
    const preparing = (await historyOf(order.id)).filter(
      (h) => h === 'PAID>PREPARING',
    );
    expect(preparing).toHaveLength(1);
  });

  it('RBAC: Customer không đổi được trạng thái; barista bị vô hiệu hóa (JWT còn hạn) bị từ chối', async () => {
    const order = await newPaidOrder();

    await advance(order.id, 'PREPARING', customerToken).expect(403);
    expect(await statusOf(order.id)).toBe('PAID');

    const disabled = await prisma.user.create({
      data: {
        username: `sm-${randomUUID()}`,
        passwordHash: 'test-only',
        role: 'BARISTA',
        isActive: false,
      },
    });
    const jwt = app.get(JwtService);
    const disabledToken = jwt.sign({
      sub: disabled.id,
      role: 'BARISTA',
      username: disabled.username,
    });
    await advance(order.id, 'PREPARING', disabledToken).expect(401);
    expect(await statusOf(order.id)).toBe('PAID');
  });

  it('hàng đợi chỉ có PAID, PREPARING, READY; đơn PENDING và COMPLETED không xuất hiện', async () => {
    const pending = await newOrder();
    const paid = await newPaidOrder();
    const preparing = await newPaidOrder();
    await advance(preparing.id, 'PREPARING').expect(200);
    const ready = await newPaidOrder();
    await advance(ready.id, 'PREPARING').expect(200);
    await advance(ready.id, 'READY').expect(200);
    const done = await newPaidOrder();
    for (const s of ['PREPARING', 'READY', 'COMPLETED'])
      await advance(done.id, s).expect(200);

    const response = await request(app.getHttpServer())
      .get('/api/v1/staff/orders?limit=200')
      .set('Authorization', bearer(baristaToken))
      .expect(200);
    const byId = new Map<string, string>(
      response.body.data.map((o: { id: string; status: string }) => [
        o.id,
        o.status,
      ]),
    );

    expect(byId.get(paid.id)).toBe('PAID');
    expect(byId.get(preparing.id)).toBe('PREPARING');
    expect(byId.get(ready.id)).toBe('READY');
    expect(byId.has(pending.id)).toBe(false);
    expect(byId.has(done.id)).toBe(false);
    for (const status of byId.values()) {
      expect(['PAID', 'PREPARING', 'READY']).toContain(status);
    }

    const onlyPaid = await request(app.getHttpServer())
      .get('/api/v1/staff/orders?status=PAID&limit=200')
      .set('Authorization', bearer(baristaToken))
      .expect(200);
    expect(
      onlyPaid.body.data.every((o: { status: string }) => o.status === 'PAID'),
    ).toBe(true);
    expect(onlyPaid.body.data.map((o: { id: string }) => o.id)).toContain(
      paid.id,
    );

    await request(app.getHttpServer())
      .get('/api/v1/staff/orders')
      .set('Authorization', bearer(customerToken))
      .expect(403);
  });
});
