// Kiểm tra giá và quyền tạo đơn, tranh tồn kho/coupon, hoàn tác, lịch sử và chặn thanh toán trùng.
import { randomUUID } from 'node:crypto';
import {
  ConflictException,
  INestApplication,
  ValidationPipe,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import request from 'supertest';

import { AppModule } from '../../src/app.module.js';
import { PrismaService } from '../../src/database/prisma.service.js';
import { PromotionsService } from '../../src/modules/promotions/services/promotions.service.js';
import { OrderExpiryJob } from '../../src/modules/orders/services/order-expiry.job.js';
import { PaymentRecoveryService } from '../../src/modules/payments/services/payment-recovery.service.js';


const connectionString = process.env.SMOKE_DATABASE_URL;
if (
  !connectionString ||
  !new URL(connectionString).pathname
    .slice(1)
    .startsWith('brewlite_foundation_smoke')
) {
  throw new Error(
    'Orders tests require a disposable brewlite_foundation_smoke* database',
  );
}

describe('Tạo đơn qua HTTP và PostgreSQL', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let userId: string;
  let otherUserId: string;
  let token: string;
  let otherToken: string;
  let baristaToken: string;
  let paymentOperatorToken: string;
  let paymentOperatorId: string;
  const previousUrl = process.env.DATABASE_URL;
  const auth = (req: request.Test, bearer = token) =>
    req.set('Authorization', `Bearer ${bearer}`);
  // Cho phép chỉ định người dùng khi kiểm thử giới hạn coupon giữa nhiều khách hàng.
  const post = (items: unknown[], couponCode?: string, bearer = token) =>
    auth(request(app.getHttpServer()).post('/api/v1/orders'), bearer).send({
      items,
      ...(couponCode ? { couponCode } : {}),
    });

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
    const jwt = app.get(JwtService);
    const users = await Promise.all(
      (['CUSTOMER', 'CUSTOMER', 'BARISTA', 'PAYMENT_OPERATOR'] as const).map((role) =>
        prisma.user.create({
          data: {
            username: `orders-${randomUUID()}`,
            passwordHash: 'test-only',
            role,
          },
        }),
      ),
    );
    userId = users[0].id;
    otherUserId = users[1].id;
    paymentOperatorId = users[3].id;
    [token, otherToken, baristaToken, paymentOperatorToken] = users.map((user) =>
      jwt.sign({ sub: user.id, role: user.role, username: user.username }),
    );
  });
  afterEach(() => vi.restoreAllMocks());
  afterAll(async () => {
    await app?.close();
    if (previousUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = previousUrl;
  });

  // Mỗi ly cần 10g cà phê; kho nguyên liệu đủ cho `cups` ly (không lưu số ly).
  const GRAMS_PER_CUP = 10;
  async function product(cups = 20, price = 40000n) {
    const ingredient = await prisma.ingredient.create({
      data: {
        code: `ORD-BEAN-${randomUUID()}`,
        name: 'Test coffee beans',
        unit: 'G',
        stockQuantity: cups * GRAMS_PER_CUP,
      },
    });
    const row = await prisma.product.create({
      data: {
        sku: randomUUID(),
        name: 'Original coffee',
        imageUrl: '/test.png',
        variants: {
          create: {
            size: 'M',
            price,
            recipeItems: {
              create: { ingredientId: ingredient.id, quantity: GRAMS_PER_CUP },
            },
          },
        },
      },
      include: { variants: true },
    });
    return {
      productId: row.id,
      id: row.variants[0].id,
      ingredientId: ingredient.id,
    };
  }
  const ingredientOf = (ingredientId: string) =>
    prisma.ingredient.findUniqueOrThrow({
      where: { id: ingredientId },
    });

  // Cho phép cấu hình riêng hai loại quota để test không vô tình phụ thuộc lẫn nhau.
  async function coupon(options: {
    usageLimit?: number | null;
    perUserLimit?: number;
  } = {}) {
    return prisma.coupon.create({
      data: {
        code: `TEST-${randomUUID()}`,
        discountType: 'FIXED_AMOUNT',
        discountValue: 5000n,
        startsAt: new Date(Date.now() - 60000),
        endsAt: new Date(Date.now() + 3600000),
        usageLimit: options.usageLimit === undefined ? 1 : options.usageLimit,
        perUserLimit: options.perUserLimit ?? 1,
      },
    });
  }


  it('Gộp dòng đã chuẩn hóa, giữ tùy chọn 0/null, dữ liệu chụp lúc đặt và quyền sở hữu', async () => {
    const variant = await product();
    const item = {
      productVariantId: variant.id,
      quantity: 1,
      sugarLevel: 0,
      iceLevel: 25,
      note: '  Separate ice  ',
    };
    const response = await post([
      item,
      {
        ...item,
        productVariantId: variant.id.toUpperCase(),
        note: 'Separate ice',
      },
      { productVariantId: variant.id, quantity: 1 },
    ])
      .set('X-Request-Id', 'orders-integration')
      .expect(201);
    expect(response.headers['x-request-id']).toBe('orders-integration');
    expect(response.body.meta.requestId).toBe('orders-integration');
    const order = response.body.data;
    expect(order).toMatchObject({
      status: 'PENDING',
      subtotal: 120000,
      total: 120000,
    });
    expect(order.items).toHaveLength(2);
    expect(order.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          quantity: 2,
          sugarLevel: 0,
          iceLevel: 25,
          note: 'Separate ice',
        }),
        expect.objectContaining({
          quantity: 1,
          sugarLevel: null,
          iceLevel: null,
          note: null,
        }),
      ]),
    );
    expect(
      await prisma.inventoryReservation.count({ where: { orderId: order.id } }),
    ).toBe(1);
    // 3 ly x 10g = 30g bị trừ khỏi 200g.
    expect(await ingredientOf(variant.ingredientId)).toMatchObject({
      stockQuantity: 170,
      version: 1,
    });
    await prisma.product.update({
      where: { id: variant.productId },
      data: { name: 'Renamed coffee' },
    });
    const detail = await auth(
      request(app.getHttpServer()).get(`/api/v1/orders/${order.id}`),
    ).expect(200);
    expect(detail.body.data.items[0].productName).toBe('Original coffee');
    expect(detail.body.data.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          sugarLevel: 0,
          iceLevel: 25,
          note: 'Separate ice',
        }),
      ]),
    );
    expect(detail.body.data.timeline[0]).toMatchObject({
      fromStatus: null,
      toStatus: 'PENDING',
    });
    const denied = await auth(
      request(app.getHttpServer()).get(`/api/v1/orders/${order.id}`),
      otherToken,
    ).expect(404);
    expect(denied.body.error.code).toBe('ORDER_NOT_FOUND');
    expect(denied.headers['x-request-id']).toBe(denied.body.error.requestId);
    const history = await auth(
      request(app.getHttpServer()).get('/api/v1/orders/me'),
      otherToken,
    ).expect(200);
    expect(history.body.data).toEqual([]);
  });

  it('Bắt buộc xác thực và kiểm tra vai trò trên mọi API đơn hàng', async () => {
    for (const path of [
      '/api/v1/orders/me',
      `/api/v1/orders/${randomUUID()}`,
    ]) {
      await request(app.getHttpServer()).get(path).expect(401);
      await auth(request(app.getHttpServer()).get(path), baristaToken).expect(
        403,
      );
    }
    await request(app.getHttpServer())
      .post('/api/v1/orders')
      .send({ items: [] })
      .expect(401);
    await auth(
      request(app.getHttpServer()).post('/api/v1/orders'),
      baristaToken,
    )
      .send({ items: [] })
      .expect(403);
  });


  it('Chỉ PAYMENT_OPERATOR được khôi phục thanh toán', async () => {
    const recovery = app.get(PaymentRecoveryService);
    const recoverSpy = vi.spyOn(recovery, 'recover').mockResolvedValue({
      recoveryRequestId: randomUUID(),
      providerRequestId: 'operator-request-123',
      status: 'UNKNOWN',
      providerOutcome: 'UNKNOWN',
      paymentStatus: 'PROCESSING',
      errorCode: null,
      isRetried: false,
    } as never);
    const paymentId = randomUUID();
    const endpoint = () => request(app.getHttpServer())
      .post(`/api/v1/payments/${paymentId}/recovery`)
      .set('Idempotency-Key', 'http-recovery-key-1')
      .send({ incidentReference: 'INC-HTTP-RECOVERY' });

    await endpoint().expect(401);
    await auth(endpoint()).expect(403);
    await auth(endpoint(), baristaToken).expect(403);
    const response = await auth(endpoint(), paymentOperatorToken).expect(200);

    expect(response.body.data).toMatchObject({ status: 'UNKNOWN', paymentStatus: 'PROCESSING' });
    expect(recoverSpy).toHaveBeenCalledTimes(1);
    expect(recoverSpy).toHaveBeenCalledWith(expect.objectContaining({
      paymentId,
      idempotencyKey: 'http-recovery-key-1',
      incidentReference: 'INC-HTTP-RECOVERY',
      actorUserId: paymentOperatorId,
    }));
    const resolveSpy = vi.spyOn(recovery, 'resolveManualReview').mockResolvedValue({
      resolutionId: randomUUID(), paymentId, decision: 'REFUND_CONFIRMED',
      paymentStatus: 'REFUNDED', evidenceReference: 'VN-REFUND-HTTP-1', isRetried: false,
    } as never);
    const resolveEndpoint = () => request(app.getHttpServer())
      .post(`/api/v1/payments/${paymentId}/recovery/resolve`)
      .set('Idempotency-Key', 'http-resolution-key-1')
      .send({
        decision: 'REFUND_CONFIRMED',
        evidenceReference: 'VN-REFUND-HTTP-1',
        incidentReference: 'INC-HTTP-RESOLUTION',
      });
    await resolveEndpoint().expect(401);
    await auth(resolveEndpoint()).expect(403);
    await auth(resolveEndpoint(), baristaToken).expect(403);
    const resolveResponse = await auth(resolveEndpoint(), paymentOperatorToken).expect(200);
    expect(resolveResponse.body.data).toMatchObject({ decision: 'REFUND_CONFIRMED', paymentStatus: 'REFUNDED' });
    expect(resolveSpy).toHaveBeenCalledWith(expect.objectContaining({
      paymentId, idempotencyKey: 'http-resolution-key-1', decision: 'REFUND_CONFIRMED',
      evidenceReference: 'VN-REFUND-HTTP-1', incidentReference: 'INC-HTTP-RESOLUTION', actorUserId: paymentOperatorId,
    }));
  });

  it('Từ chối tùy chọn sai, giá giả, topping trùng và số lượng trên 20', async () => {
    const variant = await product(100);
    const item = { productVariantId: variant.id, quantity: 1 };
    const topping = randomUUID();
    for (const items of [
      [{ ...item, sugarLevel: 101 }],
      [{ ...item, iceLevel: -1 }],
      [{ ...item, sugarLevel: '50' }],
      [{ ...item, unitPrice: 1 }],
      [{ ...item, toppingIds: [topping, topping.toUpperCase()] }],
      [
        { ...item, quantity: 15 },
        { ...item, quantity: 6 },
      ],
    ]) {
      const result = await post(items).expect(400);
      expect(result.body.error.code).toBe('VALIDATION_ERROR');
    }
    expect(await ingredientOf(variant.ingredientId)).toMatchObject({
      stockQuantity: 1000,
      version: 0,
    });
  });

  it('Hoàn tác đơn, tồn kho, lượt giữ nguyên liệu và coupon khi lỗi cuối giao dịch', async () => {
    const variant = await product();
    const promotion = await coupon();
    // Topping nhập sẵn: 1 phần = 30g trân châu 3Q.
    const pearl = await prisma.ingredient.create({
      data: {
        code: `ORD-PEARL-${randomUUID()}`,
        name: 'Test pearl',
        unit: 'G',
        stockQuantity: 300,
      },
    });
    const topping = await prisma.topping.create({
      data: {
        code: randomUUID(),
        name: 'Pearl',
        price: 5000n,
        type: 'PREPACKAGED',
        recipeItems: { create: { ingredientId: pearl.id, quantity: 30 } },
      },
    });
    await prisma.productTopping.create({
      data: { productId: variant.productId, toppingId: topping.id },
    });
    const counts = async () =>
      Promise.all([
        prisma.order.count({ where: { userId } }),
        prisma.orderItem.count(),
        prisma.orderItemTopping.count(),
        prisma.inventoryReservation.count(),
        prisma.orderStatusHistory.count(),
      ]);
    const before = await counts();
    const promotions = app.get(PromotionsService);
    const reserve = promotions.reserve.bind(promotions);
    vi.spyOn(promotions, 'reserve').mockImplementationOnce(async (...args) => {
      await reserve(...args);
      throw new Error('Injected failure after actual coupon/stock writes');
    });
    await post(
      [{ productVariantId: variant.id, quantity: 2, toppingIds: [topping.id] }],
      promotion.code,
    ).expect(500);
    expect(await counts()).toEqual(before);
    expect(
      await prisma.couponRedemption.count({
        where: { couponId: promotion.id },
      }),
    ).toBe(0);
    expect(await ingredientOf(variant.ingredientId)).toMatchObject({
      stockQuantity: 200,
      version: 0,
    });
    // Nguyên liệu của topping cũng được hoàn tác.
    expect(await ingredientOf(pearl.id)).toMatchObject({
      stockQuantity: 300,
      version: 0,
    });
  });

  it('Giữ nguyên liệu topping theo phần đóng gói hoặc công thức', async () => {
    const variant = await product();
    const [pearl, tapioca, sugar] = await Promise.all(
      ['PEARL', 'TAPIOCA', 'SUGAR'].map((name) =>
        prisma.ingredient.create({
          data: {
            code: `ORD-${name}-${randomUUID()}`,
            name,
            unit: 'G',
            stockQuantity: 1000,
          },
        }),
      ),
    );
    const prepackaged = await prisma.topping.create({
      data: {
        code: randomUUID(),
        name: 'Trân châu 3Q',
        price: 5000n,
        type: 'PREPACKAGED',
        recipeItems: { create: { ingredientId: pearl.id, quantity: 30 } },
      },
    });
    const prepared = await prisma.topping.create({
      data: {
        code: randomUUID(),
        name: 'Trân châu đen đường đen',
        price: 8000n,
        type: 'PREPARED',
        recipeItems: {
          create: [
            { ingredientId: tapioca.id, quantity: 20 },
            { ingredientId: sugar.id, quantity: 15 },
          ],
        },
      },
    });
    await prisma.productTopping.createMany({
      data: [prepackaged, prepared].map((topping) => ({
        productId: variant.productId,
        toppingId: topping.id,
      })),
    });

    const response = await post([
      {
        productVariantId: variant.id,
        quantity: 2,
        toppingIds: [prepackaged.id, prepared.id],
      },
    ]).expect(201);

    // 2 ly x (10g cà phê) và 2 phần mỗi topping.
    expect(await ingredientOf(variant.ingredientId)).toMatchObject({
      stockQuantity: 180,
    });
    expect((await ingredientOf(pearl.id)).stockQuantity).toBe(940);
    expect((await ingredientOf(tapioca.id)).stockQuantity).toBe(960);
    expect((await ingredientOf(sugar.id)).stockQuantity).toBe(970);
    const items = await prisma.inventoryReservationItem.findMany({
      where: { reservation: { orderId: response.body.data.id } },
    });
    expect(items).toHaveLength(4);

    // Hết một nguyên liệu của topping chế biến thì đơn bị từ chối, không trừ gì thêm.
    await prisma.ingredient.update({
      where: { id: sugar.id },
      data: { stockQuantity: 10 },
    });
    const rejected = await post([
      {
        productVariantId: variant.id,
        quantity: 1,
        toppingIds: [prepared.id],
      },
    ]).expect(409);
    expect(rejected.body.error.code).toBe('OUT_OF_STOCK');
    expect((await ingredientOf(tapioca.id)).stockQuantity).toBe(960);
    expect((await ingredientOf(variant.ingredientId)).stockQuantity).toBe(180);
  });

  it('Từ chối tùy chọn hết hàng và tài khoản vô hiệu trước khi ghi', async () => {
    const variant = await product();
    const item = { productVariantId: variant.id, quantity: 1 };
    const invalidTopping = await post([
      { ...item, toppingIds: [randomUUID()] },
    ]).expect(400);
    expect(invalidTopping.body.error.code).toBe('INVALID_OPTION');
    await prisma.product.update({
      where: { id: variant.productId },
      data: { isActive: false },
    });
    const inactiveProduct = await post([item]).expect(400);
    expect(inactiveProduct.body.error.code).toBe('INVALID_OPTION');
    await prisma.product.update({
      where: { id: variant.productId },
      data: { isActive: true },
    });
    await prisma.user.update({
      where: { id: userId },
      data: { isActive: false },
    });
    try {
      const inactiveUser = await post([item]).expect(401);
      expect(inactiveUser.body.error.code).toBe('UNAUTHORIZED');
    } finally {
      await prisma.user.update({
        where: { id: userId },
        data: { isActive: true },
      });
    }
    expect(
      await prisma.orderItem.count({ where: { productVariantId: variant.id } }),
    ).toBe(0);
  });

  it('Các kích cỡ dùng chung tồn nguyên liệu và không giữ độc lập theo kích cỡ', async () => {
    const medium = await product(3); // 30g total, M uses 10g.
    const small = await prisma.productVariant.create({ data: { productId: medium.productId, size: 'S', price: 30000n,
      recipeItems: { create: { ingredientId: medium.ingredientId, quantity: 5 } } } });
    const large = await prisma.productVariant.create({ data: { productId: medium.productId, size: 'L', price: 50000n,
      recipeItems: { create: { ingredientId: medium.ingredientId, quantity: 20 } } } });
    // Each size is individually available, but 2 M + 1 L needs 40g, not 30g.
    await post([{ productVariantId: medium.id, quantity: 2 }, { productVariantId: large.id, quantity: 1 }]).expect(409);
    expect((await ingredientOf(medium.ingredientId)).stockQuantity).toBe(30);
    await post([{ productVariantId: small.id, quantity: 2 }, { productVariantId: large.id, quantity: 1 }]).expect(201);
    expect((await ingredientOf(medium.ingredientId)).stockQuantity).toBe(0);
    const detail = await request(app.getHttpServer()).get(`/api/v1/products/${medium.productId}`).expect(200);
    expect(detail.body.data.variants.every((v: { available: boolean }) => v.available === false)).toBe(true);
    expect(detail.body.data.variants.every((v: object) => !('availableServings' in v) && !('stock' in v))).toBe(true);
  });

  it('Hai khách đặt đồng thời: chỉ một khách giữ được ly cuối', async () => {
    const variant = await product(1);
    const results = await Promise.all([
      post([{ productVariantId: variant.id, quantity: 1 }]),
      post([{ productVariantId: variant.id, quantity: 1 }]),
    ]);
    expect(
      results.map((result) => result.status).sort((a, b) => a - b),
    ).toEqual([201, 409]);
    expect(await ingredientOf(variant.ingredientId)).toMatchObject({
      stockQuantity: 0,
      version: 1,
    });
    expect(
      await prisma.inventoryReservation.count({
        where: { productVariantId: variant.id },
      }),
    ).toBe(1);
    // Serializable có thể thấy kho đã hết, hoặc hết ngân sách retry vì
    // xung đột transaction. Cả hai đều phải là 409 và không giữ kho lần hai.
    expect(['OUT_OF_STOCK', 'INVENTORY_CONFLICT']).toContain(
      results.find((result) => result.status === 409)?.body.error.code,
    );
    // Khi không còn tranh chấp, mã lỗi phải chính xác là OUT_OF_STOCK.
    const soldOut = await post([
      { productVariantId: variant.id, quantity: 1 },
    ]).expect(409);
    expect(soldOut.body.error.code).toBe('OUT_OF_STOCK');
    expect(await prisma.orderItem.count({
      where: { productVariantId: variant.id },
    })).toBe(1);
  });

  it('Coupon giới hạn chỉ được giữ một lần khi có yêu cầu đồng thời', async () => {
    const a = await product();
    const b = await product();
    const promotion = await coupon();
    const results = await Promise.all([
      post([{ productVariantId: a.id, quantity: 1 }], promotion.code),
      post([{ productVariantId: b.id, quantity: 1 }], promotion.code),
    ]);
    expect(
      results.map((result) => result.status).sort((a, b) => a - b),
    ).toEqual([201, 422]);
    expect(
      results.find((result) => result.status === 201)?.body.data,
    ).toMatchObject({
      subtotal: 40000,
      discountAmount: 5000,
      total: 35000,
    });
    expect(
      await prisma.couponRedemption.count({
        where: { couponId: promotion.id },
      }),
    ).toBe(1);
    const ingredients = await prisma.ingredient.findMany({
      where: { id: { in: [a.ingredientId, b.ingredientId] } },
    });
    // Hai kho 200g, chỉ một đơn thành công và trừ 10g.
    expect(ingredients.reduce((sum, row) => sum + row.stockQuantity, 0)).toBe(
      390,
    );
  });

  it('Áp dụng độc lập giới hạn coupon theo từng khách khi đặt đồng thời', async () => {
    // Tắt quota toàn cục để chỉ perUserLimit có thể từ chối request thứ hai.
    const firstVariant = await product();
    const secondVariant = await product();
    const promotion = await coupon({ usageLimit: null, perUserLimit: 1 });

    const results = await Promise.all([
      post([{ productVariantId: firstVariant.id, quantity: 1 }], promotion.code),
      post([{ productVariantId: secondVariant.id, quantity: 1 }], promotion.code),
    ]);

    expect(
      results.map((result) => result.status).sort((a, b) => a - b),
    ).toEqual([201, 422]);
    expect(
      results.find((result) => result.status === 422)?.body.error.code,
    ).toBe('COUPON_NOT_APPLICABLE');
    expect(
      await prisma.couponRedemption.count({
        where: { couponId: promotion.id, userId },
      }),
    ).toBe(1);
  });

  it('Áp dụng giới hạn coupon toàn cục giữa nhiều khách', async () => {
    // Cho phép mỗi user dùng nhiều lần để chỉ usageLimit toàn cục quyết định kết quả.
    const firstVariant = await product();
    const secondVariant = await product();
    const promotion = await coupon({ usageLimit: 1, perUserLimit: 2 });

    const results = await Promise.all([
      post([{ productVariantId: firstVariant.id, quantity: 1 }], promotion.code, token),
      post([{ productVariantId: secondVariant.id, quantity: 1 }], promotion.code, otherToken),
    ]);

    expect(
      results.map((result) => result.status).sort((a, b) => a - b),
    ).toEqual([201, 422]);
    expect(
      results.find((result) => result.status === 422)?.body.error.code,
    ).toBe('COUPON_NOT_APPLICABLE');

    const redemptions = await prisma.couponRedemption.findMany({
      where: { couponId: promotion.id },
      select: { userId: true },
    });
    expect(redemptions).toHaveLength(1);
    expect([userId, otherUserId]).toContain(redemptions[0].userId);
  });

  it('Dùng tổng tiền do máy chủ tính khi tạo đơn sau bước xem trước coupon', async () => {
    const variant = await product(5, 40000n);
    const promotion = await prisma.coupon.create({
      data: {
        code: `PREVIEW-${randomUUID()}`,
        discountType: 'PERCENTAGE',
        discountValue: 50n,
        minOrderValue: 0n,
        startsAt: new Date(Date.now() - 60000),
        endsAt: new Date(Date.now() + 3600000),
        usageLimit: 1,
        perUserLimit: 1,
      },
    });

    // Preview là ước tính theo subtotal client gửi; không được dùng để chốt số tiền Order.
    const preview = await auth(
      request(app.getHttpServer()).post('/api/v1/coupons/validate'),
    )
      .send({ code: promotion.code, subtotal: 100000 })
      .expect(200);
    expect(preview.body.data.discountAmount).toBe(50000);

    // Khi tạo Order, server tự đọc giá variant (40.000 VND) và tính lại discount (20.000 VND).
    const orderResponse = await post(
      [{ productVariantId: variant.id, quantity: 1 }],
      promotion.code,
    ).expect(201);
    expect(orderResponse.body.data).toMatchObject({
      subtotal: 40000,
      discountAmount: 20000,
      total: 20000,
    });

    const redemption = await prisma.couponRedemption.findFirstOrThrow({
      where: { orderId: orderResponse.body.data.id },
    });
    expect(redemption.discountAmount).toBe(20000n);
  });

  it('Từ chối số tiền vượt miền số nguyên JSON trước khi ghi', async () => {
    const variant = await product(20, BigInt(Number.MAX_SAFE_INTEGER));
    const result = await post([
      { productVariantId: variant.id, quantity: 2 },
    ]).expect(500);
    expect(result.body.error.code).toBe('INTERNAL_ERROR');
    expect(
      await prisma.orderItem.count({ where: { productVariantId: variant.id } }),
    ).toBe(0);
    expect(await ingredientOf(variant.ingredientId)).toMatchObject({
      stockQuantity: 200,
      version: 0,
    });
  });

  it('Phân trang đúng khi trùng thời điểm và không lộ đơn của khách khác', async () => {
    const variant = await product();
    const first = await post([
      { productVariantId: variant.id, quantity: 1 },
    ]).expect(201);
    const second = await post([
      { productVariantId: variant.id, quantity: 1 },
    ]).expect(201);
    const ids = [first.body.data.id, second.body.data.id].sort(
      (a: string, b: string) => b.localeCompare(a),
    );
    await prisma.order.updateMany({
      where: { id: { in: ids } },
      data: { createdAt: new Date('2030-01-01T00:00:00Z') },
    });
    const page1 = await auth(
      request(app.getHttpServer()).get(
        '/api/v1/orders/me?limit=1&status=PENDING',
      ),
    ).expect(200);
    expect(page1.body.data[0].id).toBe(ids[0]);
    expect(page1.body.meta.nextCursor).toBe(ids[0]);
    const page2 = await auth(
      request(app.getHttpServer()).get(
        `/api/v1/orders/me?limit=1&cursor=${ids[0]}`,
      ),
    ).expect(200);
    expect(page2.body.data[0].id).toBe(ids[1]);
    const other = await auth(
      request(app.getHttpServer()).get(`/api/v1/orders/me?cursor=${ids[0]}`),
      otherToken,
    ).expect(200);
    expect(other.body.data).toEqual([]);
    for (const query of [
      'limit=0',
      'limit=101',
      'cursor=invalid',
      'status=INVALID',
    ]) {
      await auth(
        request(app.getHttpServer()).get(`/api/v1/orders/me?${query}`),
      ).expect(400);
    }
  });
  it('Thử lại thanh toán chỉ tiêu thụ coupon một lần; đơn thất bại hết hạn thì hoàn tồn và coupon', async () => {
    // Chỉ mock Gateway bên ngoài; Order, Payment, Coupon và Inventory vẫn chạy trên PostgreSQL thật.
    const { PaymentsService } = await import('../../src/modules/payments/services/payments.service.js');
    const { MockGatewayService } = await import('../../src/modules/payments/services/mock-gateway.service.js');

    const paymentsService = app.get(PaymentsService);
    const mockGateway = app.get(MockGatewayService);
    const expiryJob = app.get(OrderExpiryJob);
    const gatewayCharge = vi.spyOn(mockGateway, 'charge');

    const variant = await product();
    const promotion = await coupon();

    // KỊCH BẢN 1: Thanh toán thất bại phải giữ coupon và inventory để khách retry.
    const orderResponse = await post(
      [{ productVariantId: variant.id, quantity: 1 }],
      promotion.code,
    ).expect(201);
    const orderId = orderResponse.body.data.id;
    const totalAmount = BigInt(orderResponse.body.data.total);

    let redemption = await prisma.couponRedemption.findFirstOrThrow({
      where: { orderId },
    });
    expect(redemption.status).toBe('RESERVED');

    gatewayCharge.mockResolvedValueOnce({
      success: false,
      errorCode: 'INSUFFICIENT_FUNDS',
    });
    const failedPaymentResult = await paymentsService.processPayment({
      idempotencyKey: `fail-key-${randomUUID()}`,
      orderId,
      userId,
      method: 'E_WALLET',
      amount: totalAmount,
    });
    expect(failedPaymentResult.success).toBe(false);
    expect(await prisma.order.findUniqueOrThrow({ where: { id: orderId } }))
      .toMatchObject({ status: 'PAYMENT_FAILED' });
    expect(await prisma.payment.findFirstOrThrow({ where: { orderId } }))
      .toMatchObject({ status: 'FAILED', failureCode: 'INSUFFICIENT_FUNDS' });
    redemption = await prisma.couponRedemption.findFirstOrThrow({
      where: { orderId },
    });
    expect(redemption.status).toBe('RESERVED');
    expect(await prisma.inventoryReservation.findFirstOrThrow({ where: { orderId } }))
      .toMatchObject({ status: 'ACTIVE' });

    // KỊCH BẢN 2: Retry bằng key mới thành công; chỉ quyết toán coupon và Loyalty một lần.
    const successKey = `success-key-${randomUUID()}`;
    gatewayCharge.mockResolvedValueOnce({
      success: true,
      gatewayTransactionId: `GW-RETRY-${randomUUID()}`,
    });
    const successResult = await paymentsService.processPayment({
      idempotencyKey: successKey,
      orderId,
      userId,
      method: 'E_WALLET',
      amount: totalAmount,
    });
    expect(successResult.success).toBe(true);
    expect(await prisma.order.findUniqueOrThrow({ where: { id: orderId } }))
      .toMatchObject({ status: 'PAID' });
    expect(await prisma.couponRedemption.findFirstOrThrow({ where: { orderId } }))
      .toMatchObject({ status: 'CONSUMED', consumedAt: expect.any(Date) });
    expect(await prisma.inventoryReservation.findFirstOrThrow({ where: { orderId } }))
      .toMatchObject({ status: 'CONSUMED' });
    expect(await prisma.payment.count({ where: { orderId } })).toBe(2);
    expect(await prisma.loyaltyTransaction.count({
      where: { orderId, type: 'EARN' },
    })).toBe(1);

    // Replay cùng key phải trả kết quả cũ, không gọi Gateway và không consume coupon lần hai.
    const gatewayCallsAfterSuccess = gatewayCharge.mock.calls.length;
    const replayResult = await paymentsService.processPayment({
      idempotencyKey: successKey,
      orderId,
      userId,
      method: 'E_WALLET',
      amount: totalAmount,
    });
    expect(replayResult).toMatchObject({
      success: true,
      isRetried: true,
      status: 'SUCCEEDED',
    });
    expect(gatewayCharge).toHaveBeenCalledTimes(gatewayCallsAfterSuccess);
    expect(await prisma.couponRedemption.count({
      where: { orderId, status: 'CONSUMED' },
    })).toBe(1);
    expect(await prisma.loyaltyTransaction.count({
      where: { orderId, type: 'EARN' },
    })).toBe(1);

    // KỊCH BẢN 3: Payment FAILED rồi hết hạn; Cron thật phải hủy Order, release coupon và hoàn kho.
    const promotion2 = await coupon();
    // Lưu tồn kho trước khi tạo đơn để xác nhận Cron hoàn về đúng baseline ban đầu.
    const stockBeforeExpiryOrder = await prisma.ingredient.findUniqueOrThrow({
      where: { id: variant.ingredientId },
    });
    const orderResponse2 = await post(
      [{ productVariantId: variant.id, quantity: 1 }],
      promotion2.code,
    ).expect(201);
    const expiredOrderId = orderResponse2.body.data.id;
    const expiredOrderAmount = BigInt(orderResponse2.body.data.total);
    const stockAfterReservation = await prisma.ingredient.findUniqueOrThrow({
      where: { id: variant.ingredientId },
    });

    gatewayCharge.mockResolvedValueOnce({
      success: false,
      errorCode: 'INSUFFICIENT_FUNDS',
    });
    await paymentsService.processPayment({
      idempotencyKey: `expiry-fail-key-${randomUUID()}`,
      orderId: expiredOrderId,
      userId,
      method: 'E_WALLET',
      amount: expiredOrderAmount,
    });
    expect(await prisma.order.findUniqueOrThrow({
      where: { id: expiredOrderId },
    })).toMatchObject({ status: 'PAYMENT_FAILED' });
    const expiryRedemption = await prisma.couponRedemption.findFirstOrThrow({
      where: { orderId: expiredOrderId },
    });
    const expiryReservation = await prisma.inventoryReservation.findFirstOrThrow({
      where: { orderId: expiredOrderId },
    });
    expect(expiryRedemption.status).toBe('RESERVED');
    expect(expiryReservation.status).toBe('ACTIVE');

    // Đẩy hạn giữ chỗ của Order, Coupon và Inventory về quá khứ để kiểm tra nhánh expiry.
    const expiredAt = new Date(Date.now() - 60_000);
    await prisma.order.update({
      where: { id: expiredOrderId },
      data: { reservationExpiresAt: expiredAt },
    });
    await prisma.couponRedemption.update({
      where: { id: expiryRedemption.id },
      data: { expiresAt: expiredAt },
    });
    await prisma.inventoryReservation.update({
      where: { id: expiryReservation.id },
      data: { expiresAt: expiredAt },
    });

    // Retry trước khi Cron chạy phải bị chặn ngay bởi deadline đã qua.
    const gatewayCallsBeforeExpiredRetry = gatewayCharge.mock.calls.length;
    const expiredRetryError = await paymentsService.processPayment({
      idempotencyKey: `expired-retry-key-${randomUUID()}`,
      orderId: expiredOrderId,
      userId,
      method: 'E_WALLET',
      amount: expiredOrderAmount,
    }).then(() => null, (error: unknown) => error);
    expect(expiredRetryError).toBeInstanceOf(ConflictException);
    expect((expiredRetryError as ConflictException).getResponse()).toMatchObject({
      code: 'ORDER_EXPIRED',
    });
    expect(gatewayCharge).toHaveBeenCalledTimes(gatewayCallsBeforeExpiredRetry);

    // Cron job thật phải kết thúc toàn bộ vòng đời trong cùng transaction.
    await expiryJob.handleExpiredOrders();
    expect(await prisma.order.findUniqueOrThrow({
      where: { id: expiredOrderId },
    })).toMatchObject({ status: 'CANCELLED' });
    expect(await prisma.couponRedemption.findUniqueOrThrow({
      where: { id: expiryRedemption.id },
    })).toMatchObject({ status: 'EXPIRED', releasedAt: expect.any(Date) });
    expect(await prisma.inventoryReservation.findUniqueOrThrow({
      where: { id: expiryReservation.id },
    })).toMatchObject({ status: 'EXPIRED' });
    const stockAfterExpiry = await prisma.ingredient.findUniqueOrThrow({
      where: { id: variant.ingredientId },
    });
    expect(stockAfterExpiry).toMatchObject({
      stockQuantity: stockBeforeExpiryOrder.stockQuantity,
      version: stockAfterReservation.version + 1,
    });

    // Chạy Cron lặp và retry sau khi đã CANCELLED đều không được tạo side effect lần hai.
    await expiryJob.handleExpiredOrders();
    expect(await prisma.ingredient.findUniqueOrThrow({
      where: { id: variant.ingredientId },
    })).toMatchObject({
      stockQuantity: stockBeforeExpiryOrder.stockQuantity,
      version: stockAfterReservation.version + 1,
    });
    expect(await prisma.couponRedemption.findUniqueOrThrow({
      where: { id: expiryRedemption.id },
    })).toMatchObject({ status: 'EXPIRED' });

    const cancelledRetryError = await paymentsService.processPayment({
      idempotencyKey: `cancelled-retry-key-${randomUUID()}`,
      orderId: expiredOrderId,
      userId,
      method: 'E_WALLET',
      amount: expiredOrderAmount,
    }).then(() => null, (error: unknown) => error);
    expect(cancelledRetryError).toBeInstanceOf(ConflictException);
    expect((cancelledRetryError as ConflictException).getResponse()).toMatchObject({
      code: 'ORDER_INVALID_TRANSITION',
    });
    expect(gatewayCharge).toHaveBeenCalledTimes(gatewayCallsBeforeExpiredRetry);
    expect(await prisma.payment.count({ where: { orderId: expiredOrderId } })).toBe(1);
    expect(await prisma.couponRedemption.count({
      where: { orderId: expiredOrderId, status: 'CONSUMED' },
    })).toBe(0);
  });

  it('Khách hủy đơn của mình qua HTTP và hoàn tồn cùng coupon đúng một lần', async () => {
    const variant = await product();
    const promotion = await coupon();

    const orderResponse = await post(
      [{ productVariantId: variant.id, quantity: 1 }],
      promotion.code,
    ).expect(201);
    const orderId = orderResponse.body.data.id;
    const stockAfterReservation = await prisma.ingredient.findUniqueOrThrow({
      where: { id: variant.ingredientId },
    });
    const redemption = await prisma.couponRedemption.findFirstOrThrow({
      where: { orderId },
    });
    const reservation = await prisma.inventoryReservation.findFirstOrThrow({
      where: { orderId },
    });
    expect(redemption.status).toBe('RESERVED');
    expect(reservation.status).toBe('ACTIVE');

    // Đơn không được hủy bởi khách hàng khác hoặc principal không có vai trò CUSTOMER.
    await auth(
      request(app.getHttpServer()).post(`/api/v1/orders/${orderId}/cancel`),
      otherToken,
    ).expect(404);
    await auth(
      request(app.getHttpServer()).post(`/api/v1/orders/${orderId}/cancel`),
      baristaToken,
    ).expect(403);

    const cancellation = await auth(
      request(app.getHttpServer()).post(`/api/v1/orders/${orderId}/cancel`),
    ).expect(200);
    expect(cancellation.body.data).toMatchObject({
      id: orderId,
      status: 'CANCELLED',
    });

    expect(await prisma.order.findUniqueOrThrow({ where: { id: orderId } }))
      .toMatchObject({ status: 'CANCELLED' });
    expect(await prisma.couponRedemption.findUniqueOrThrow({
      where: { id: redemption.id },
    })).toMatchObject({ status: 'RELEASED', releasedAt: expect.any(Date) });
    expect(await prisma.inventoryReservation.findUniqueOrThrow({
      where: { id: reservation.id },
    })).toMatchObject({ status: 'RELEASED' });
    expect(await prisma.ingredient.findUniqueOrThrow({
      where: { id: variant.ingredientId },
    })).toMatchObject({
      stockQuantity: stockAfterReservation.stockQuantity + 10,
      version: stockAfterReservation.version + 1,
    });

    // Hủy lặp qua HTTP phải bị từ chối và tuyệt đối không hoàn kho lần hai.
    const repeatedCancellation = await auth(
      request(app.getHttpServer()).post(`/api/v1/orders/${orderId}/cancel`),
    ).expect(409);
    expect(repeatedCancellation.body.error.code).toBe('ORDER_INVALID_TRANSITION');
    expect(await prisma.ingredient.findUniqueOrThrow({
      where: { id: variant.ingredientId },
    })).toMatchObject({
      stockQuantity: stockAfterReservation.stockQuantity + 10,
      version: stockAfterReservation.version + 1,
    });
    expect(await prisma.couponRedemption.findUniqueOrThrow({
      where: { id: redemption.id },
    })).toMatchObject({ status: 'RELEASED' });
  });

  it('Chặn thanh toán thứ hai trên cùng đơn đang PROCESSING dù khóa khác nhau', async () => {
    // Giữ Gateway của request đầu ở trạng thái chờ để request thứ hai va vào ràng buộc DB.
    const { PaymentsService } = await import('../../src/modules/payments/services/payments.service.js');
    const { MockGatewayService } = await import('../../src/modules/payments/services/mock-gateway.service.js');
    const paymentsService = app.get(PaymentsService);
    const mockGateway = app.get(MockGatewayService);

    const variant = await product();
    const orderResponse = await post([
      { productVariantId: variant.id, quantity: 1 },
    ]).expect(201);
    const orderId = orderResponse.body.data.id;
    const totalAmount = BigInt(orderResponse.body.data.total);

    let releaseGateway!: (result: {
      success: boolean;
      errorCode?: string;
      gatewayTransactionId?: string;
    }) => void;
    const blockedGatewayResponse = new Promise<{
      success: boolean;
      errorCode?: string;
      gatewayTransactionId?: string;
    }>((resolve) => {
      releaseGateway = resolve;
    });

    vi.spyOn(mockGateway, 'charge').mockReturnValueOnce(blockedGatewayResponse);

    const firstPayment = paymentsService.processPayment({
      idempotencyKey: `first-${randomUUID()}`,
      orderId,
      userId,
      method: 'E_WALLET',
      amount: totalAmount,
    });

    try {
      // Chờ đến khi request đầu đã ghi Payment PROCESSING vào PostgreSQL.
      let processingPaymentExists = false;
      for (let attempt = 0; attempt < 50; attempt += 1) {
        const payment = await prisma.payment.findFirst({
          where: { orderId, status: 'PROCESSING' },
        });
        if (payment) {
          processingPaymentExists = true;
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      expect(processingPaymentExists).toBe(true);

      // Request thứ hai dùng key khác nhưng phải bị DB bảo vệ trước khi gọi Gateway.
      await expect(
        paymentsService.processPayment({
          idempotencyKey: `second-${randomUUID()}`,
          orderId,
          userId,
          method: 'E_WALLET',
          amount: totalAmount,
        }),
      ).rejects.toMatchObject({
        response: {
          code: 'PAYMENT_IN_PROGRESS',
        },
      });
    } finally {
      // Luôn giải phóng Gateway giả lập để không để request đầu bị treo khi test fail.
      releaseGateway({ success: false, errorCode: 'TEST_DECLINED' });
    }

    await firstPayment;
    expect(
      await prisma.payment.count({ where: { orderId } }),
    ).toBe(1);
    expect(
      await prisma.order.findUniqueOrThrow({ where: { id: orderId } }),
    ).toMatchObject({ status: 'PAYMENT_FAILED' });
  });
});
