// Kiểm tra báo giá coupon, tạo đơn, thanh toán và thử lại qua API với PostgreSQL.
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { AppModule } from '../../src/app.module.js';
import { PrismaService } from '../../src/database/prisma.service.js';
import { CouponRedemptionStatus, OrderStatus, PaymentStatus } from '../../src/generated/prisma/client.js';

const connectionString = process.env.SMOKE_DATABASE_URL;
if (!connectionString || !new URL(connectionString).pathname.slice(1).startsWith('brewlite_foundation_smoke')) {
  throw new Error('Checkout E2E requires a disposable brewlite_foundation_smoke* database.');
}

describe('Checkout E2E: coupon, thanh toán lỗi và thử lại', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let token: string;
  const previousDatabaseUrl = process.env.DATABASE_URL;
  const previousGatewayMode = process.env.MOCK_PAYMENT_MODE;

  const auth = (test: request.Test) => test.set('Authorization', `Bearer ${token}`);

  async function createVariant(price = 50000n) {
    const ingredient = await prisma.ingredient.create({
      data: {
        code: `CHECKOUT-BEAN-${randomUUID()}`,
        name: 'Checkout beans',
        unit: 'G',
        stockQuantity: 500,
      },
    });
    const product = await prisma.product.create({
      data: {
        sku: `CHECKOUT-${randomUUID()}`,
        name: 'Checkout coffee',
        imageUrl: '/checkout.png',
        variants: {
          create: {
            size: 'M',
            price,
            recipeItems: { create: { ingredientId: ingredient.id, quantity: 10 } },
          },
        },
      },
      include: { variants: true },
    });
    return product.variants[0];
  }

  beforeAll(async () => {
    process.env.DATABASE_URL = connectionString;
    process.env.MOCK_PAYMENT_MODE = 'deterministic';
    const module = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = module.createNestApplication();
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }));
    await app.init();
    prisma = app.get(PrismaService);

    const user = await prisma.user.create({
      data: { username: `checkout-${randomUUID()}`, passwordHash: 'test-only', role: 'CUSTOMER' },
    });
    token = app.get(JwtService).sign({ sub: user.id, username: user.username, role: user.role });
  });

  afterAll(async () => {
    await app?.close();
    if (previousDatabaseUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = previousDatabaseUrl;
    if (previousGatewayMode === undefined) delete process.env.MOCK_PAYMENT_MODE;
    else process.env.MOCK_PAYMENT_MODE = previousGatewayMode;
  });

  it('Báo giá coupon, tạo đơn giảm giá và thanh toán thành công', async () => {
    const variant = await createVariant();
    const coupon = await prisma.coupon.create({
      data: {
        code: `SAVE-${randomUUID().slice(0, 8)}`,
        discountType: 'FIXED_AMOUNT',
        discountValue: 10000n,
        minOrderValue: 30000n,
        startsAt: new Date(Date.now() - 60_000),
        endsAt: new Date(Date.now() + 3_600_000),
      },
    });

    const quote = await auth(request(app.getHttpServer()).post('/api/v1/coupons/validate'))
      .send({ code: coupon.code, subtotal: 50000 })
      .expect(200);
    expect(quote.body.data).toEqual({ code: coupon.code, discountAmount: 10000 });

    const orderResponse = await auth(request(app.getHttpServer()).post('/api/v1/orders'))
      .send({ items: [{ productVariantId: variant.id, quantity: 1 }], couponCode: coupon.code })
      .expect(201);
    expect(orderResponse.body.data).toMatchObject({ subtotal: 50000, discountAmount: 10000, total: 40000, status: 'PENDING' });

    const payment = await auth(request(app.getHttpServer()).post('/api/v1/payments'))
      .set('Idempotency-Key', randomUUID())
      .send({ orderId: orderResponse.body.data.id, method: 'E_WALLET' })
      .expect(200);
    expect(payment.body.data).toMatchObject({ success: true, isRetried: false, status: 'SUCCEEDED' });

    const detail = await auth(request(app.getHttpServer()).get(`/api/v1/orders/${orderResponse.body.data.id}`)).expect(200);
    expect(detail.body.data).toMatchObject({ status: 'PAID', total: 40000 });
    expect(detail.body.data.paymentSummary).toMatchObject({ status: 'SUCCEEDED', amount: 40000 });
    expect(await prisma.couponRedemption.findFirstOrThrow({ where: { orderId: orderResponse.body.data.id } })).toMatchObject({
      status: CouponRedemptionStatus.CONSUMED,
      discountAmount: 10000n,
    });
  });

  it('Giữ nguyên đơn sau thất bại và thử lại với khóa mới', async () => {
    const variant = await createVariant();
    const orderResponse = await auth(request(app.getHttpServer()).post('/api/v1/orders'))
      .send({ items: [{ productVariantId: variant.id, quantity: 1 }] })
      .expect(201);
    const orderId = orderResponse.body.data.id as string;
    const failedKey = randomUUID();

    const failed = await auth(request(app.getHttpServer()).post('/api/v1/payments'))
      .set('Idempotency-Key', failedKey)
      .send({ orderId, method: 'CARD' })
      .expect(200);
    expect(failed.body.data).toMatchObject({ success: false, isRetried: false, status: 'FAILED', errorCode: 'INSUFFICIENT_FUNDS' });
    expect((await prisma.order.findUniqueOrThrow({ where: { id: orderId } })).status).toBe(OrderStatus.PAYMENT_FAILED);

    const replay = await auth(request(app.getHttpServer()).post('/api/v1/payments'))
      .set('Idempotency-Key', failedKey)
      .send({ orderId, method: 'CARD' })
      .expect(200);
    expect(replay.body.data).toMatchObject({ success: false, isRetried: true, status: 'FAILED', errorCode: 'INSUFFICIENT_FUNDS' });

    const retried = await auth(request(app.getHttpServer()).post('/api/v1/payments'))
      .set('Idempotency-Key', randomUUID())
      .send({ orderId, method: 'E_WALLET' })
      .expect(200);
    expect(retried.body.data).toMatchObject({ success: true, isRetried: false, status: 'SUCCEEDED' });
    expect((await prisma.order.findUniqueOrThrow({ where: { id: orderId } })).status).toBe(OrderStatus.PAID);
    expect(await prisma.payment.findMany({ where: { orderId }, orderBy: { createdAt: 'asc' }, select: { status: true } })).toEqual([
      { status: PaymentStatus.FAILED },
      { status: PaymentStatus.SUCCEEDED },
    ]);
    expect(await prisma.orderStatusHistory.findMany({ where: { orderId }, orderBy: { createdAt: 'asc' }, select: { toStatus: true } })).toEqual([
      { toStatus: OrderStatus.PENDING },
      { toStatus: OrderStatus.PAYMENT_FAILED },
      { toStatus: OrderStatus.PENDING },
      { toStatus: OrderStatus.PAID },
    ]);
  });
});
