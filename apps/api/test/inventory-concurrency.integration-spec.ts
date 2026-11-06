import { PrismaPg } from '@prisma/adapter-pg';
import { randomUUID } from 'node:crypto';
import { PrismaClient } from '../src/generated/prisma/client.js';
import { InventoryRepository } from '../src/modules/inventory/repositories/inventory.repository.js';
import { InventoryService } from '../src/modules/inventory/services/inventory.service.js';

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

// Mỗi ly dùng 10g cà phê; kho nguyên liệu quyết định số ly làm được.
const GRAMS_PER_CUP = 10;

describe('SD-13 inventory concurrency on PostgreSQL', () => {
  const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString }),
  });
  const repository = new InventoryRepository({} as never);
  const service = new InventoryService(prisma as never, repository);

  let variantId: string;
  let ingredientId: string;
  let orderIds: string[];

  // Tạo món + công thức + nguyên liệu đủ cho `cups` ly. Không lưu số ly.
  async function createProduct(prefix: string, cups: number) {
    const ingredient = await prisma.ingredient.create({
      data: {
        code: `${prefix}-BEAN-${randomUUID()}`,
        name: `${prefix} coffee beans`,
        unit: 'G',
        stockQuantity: cups * GRAMS_PER_CUP,
      },
    });

    const product = await prisma.product.create({
      data: {
        sku: `${prefix}-${randomUUID()}`,
        name: `${prefix} test product`,
        imageUrl: `/${prefix.toLowerCase()}-test.png`,
        variants: {
          create: {
            size: 'M',
            price: 40000n,
            recipeItems: {
              create: { ingredientId: ingredient.id, quantity: GRAMS_PER_CUP },
            },
          },
        },
      },
      include: { variants: true },
    });

    return { product, variant: product.variants[0], ingredient };
  }

  async function createOrder(
    tx: Pick<PrismaClient, 'order'>,
    prefix: string,
    userId: string,
    product: { name: string },
    variantIdForOrder: string,
    reservationExpiresAt: Date,
  ) {
    return tx.order.create({
      data: {
        orderNumber: `${prefix}-${randomUUID().slice(0, 8)}`,
        userId,
        subtotal: 40000n,
        total: 40000n,
        reservationExpiresAt,
        items: {
          create: {
            productVariantId: variantIdForOrder,
            productNameSnapshot: product.name,
            variantNameSnapshot: 'M',
            unitPrice: 40000n,
            quantity: 1,
          },
        },
        statusHistories: {
          create: { toStatus: 'PENDING' },
        },
      },
    });
  }

  const ingredientOf = (id: string) =>
    prisma.ingredient.findUniqueOrThrow({ where: { id } });

  it('release restores the reserved ingredients exactly once', async () => {
    const user = await prisma.user.create({
      data: {
        username: `release-${randomUUID()}`,
        passwordHash: 'integration-test-only',
      },
    });
    const { product, variant, ingredient } = await createProduct('REL', 2);
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000);

    const reservation = await prisma.$transaction(async (tx) => {
      const order = await createOrder(
        tx as never,
        'REL',
        user.id,
        product,
        variant.id,
        expiresAt,
      );
      const reservations = await service.reserve(
        tx,
        order.id,
        [{ productVariantId: variant.id, quantity: 1 }],
        expiresAt,
      );
      return reservations[0];
    });

    expect((await ingredientOf(ingredient.id)).stockQuantity).toBe(10);

    const result = await service.release(reservation.id);

    const ingredientAfter = await ingredientOf(ingredient.id);
    const savedReservation =
      await prisma.inventoryReservation.findUniqueOrThrow({
        where: { id: reservation.id },
      });

    expect(result.status).toBe('RELEASED');
    expect(savedReservation.status).toBe('RELEASED');
    expect(ingredientAfter.stockQuantity).toBe(20);
    expect(ingredientAfter.version).toBe(2);
  });
  it('allows only one of two concurrent releases to restore ingredients', async () => {
    const user = await prisma.user.create({
      data: {
        username: `concurrent-release-${randomUUID()}`,
        passwordHash: 'integration-test-only',
      },
    });

    // Kho có 20g, một reservation sẽ giữ 10g.
    const { product, variant, ingredient } = await createProduct('CREL', 2);
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000);

    // Tạo đơn và reservation trong cùng transaction.
    const reservation = await prisma.$transaction(async (tx) => {
      const order = await createOrder(
        tx as never,
        'CREL',
        user.id,
        product,
        variant.id,
        expiresAt,
      );

      const reservations = await service.reserve(
        tx,
        order.id,
        [{ productVariantId: variant.id, quantity: 1 }],
        expiresAt,
      );

      return reservations[0];
    });

    if (!reservation) {
      throw new Error('Inventory reservation was not created');
    }

    // Sau khi reserve, kho còn 10g.
    const stockAfterReserve = await ingredientOf(ingredient.id);

    expect(stockAfterReserve.stockQuantity).toBe(10);
    expect(stockAfterReserve.version).toBe(1);

    // Hai transaction cùng release một reservation.
    const results = await Promise.allSettled([
      service.release(reservation.id),
      service.release(reservation.id),
    ]);

    const successes = results.filter(
      (result) => result.status === 'fulfilled',
    );

    const failures = results.filter(
      (result) => result.status === 'rejected',
    );

    // Chỉ một transaction được phép release thành công.
    expect(successes).toHaveLength(1);
    expect(failures).toHaveLength(1);

    // Kiểm tra dữ liệu thực tế trong PostgreSQL.
    const savedReservation =
      await prisma.inventoryReservation.findUniqueOrThrow({
        where: { id: reservation.id },
      });

    const ingredientAfterRelease = await ingredientOf(ingredient.id);

    expect(savedReservation.status).toBe('RELEASED');

    // Chỉ hoàn lại 10g đúng một lần.
    expect(ingredientAfterRelease.stockQuantity).toBe(20);

    // Version chỉ tăng từ 1 lên 2.
    expect(ingredientAfterRelease.version).toBe(2);
  });

  it('expires an overdue reservation and restores ingredients exactly once', async () => {
    const user = await prisma.user.create({
      data: {
        username: `expiry-${randomUUID()}`,
        passwordHash: 'integration-test-only',
      },
    });
    const { product, variant, ingredient } = await createProduct('EXP', 2);
    // Thời điểm hết hạn đã ở trong quá khứ.
    const expiresAt = new Date(Date.now() - 60_000);

    const reservation = await prisma.$transaction(async (tx) => {
      const order = await createOrder(
        tx as never,
        'EXP',
        user.id,
        product,
        variant.id,
        new Date(Date.now() + 900_000),
      );
      // Giữ hàng bằng một expiry còn ở tương lai trước.
      const reservations = await service.reserve(
        tx,
        order.id,
        [{ productVariantId: variant.id, quantity: 1 }],
        new Date(Date.now() + 900_000),
      );
      return reservations[0];
    });

    // Đưa expiry của reservation về quá khứ để mô phỏng hết hạn.
    await prisma.inventoryReservation.update({
      where: { id: reservation.id },
      data: { expiresAt },
    });

    const result = await service.release(reservation.id, true);

    const savedReservation =
      await prisma.inventoryReservation.findUniqueOrThrow({
        where: { id: reservation.id },
      });
    const ingredientAfter = await ingredientOf(ingredient.id);

    expect(result.status).toBe('EXPIRED');
    expect(savedReservation.status).toBe('EXPIRED');
    expect(ingredientAfter.stockQuantity).toBe(20);
    expect(ingredientAfter.version).toBe(2);

    // Gọi lại không được hoàn nguyên liệu lần thứ hai.
    await expect(service.release(reservation.id, true)).rejects.toThrow();

    const ingredientAfterSecondAttempt = await ingredientOf(ingredient.id);
    expect(ingredientAfterSecondAttempt.stockQuantity).toBe(20);
    expect(ingredientAfterSecondAttempt.version).toBe(2);
  });

  it('release restores the recorded quantity even if the recipe changed after ordering', async () => {
    const user = await prisma.user.create({
      data: {
        username: `recipe-change-${randomUUID()}`,
        passwordHash: 'integration-test-only',
      },
    });
    const { product, variant, ingredient } = await createProduct('RCP', 5);
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000);

    const reservation = await prisma.$transaction(async (tx) => {
      const order = await createOrder(
        tx as never,
        'RCP',
        user.id,
        product,
        variant.id,
        expiresAt,
      );
      const reservations = await service.reserve(
        tx,
        order.id,
        [{ productVariantId: variant.id, quantity: 2 }],
        expiresAt,
      );
      return reservations[0];
    });

    // Công thức đổi từ 10g lên 15g sau khi khách đã đặt.
    await prisma.recipeItem.update({
      where: {
        productVariantId_ingredientId: {
          productVariantId: variant.id,
          ingredientId: ingredient.id,
        },
      },
      data: { quantity: 15 },
    });

    await service.release(reservation.id);

    // Phải hoàn đúng 20g đã giữ, quay về 50g.
    expect((await ingredientOf(ingredient.id)).stockQuantity).toBe(50);
  });

  it('consume changes ACTIVE reservation to CONSUMED without restoring ingredients', async () => {
    const user = await prisma.user.create({
      data: {
        username: `consume-${randomUUID()}`,
        passwordHash: 'integration-test-only',
      },
    });
    const { product, variant, ingredient } = await createProduct('CON', 2);
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000);

    const result = await prisma.$transaction(async (tx) => {
      const order = await createOrder(
        tx as never,
        'CON',
        user.id,
        product,
        variant.id,
        expiresAt,
      );
      const reservations = await service.reserve(
        tx,
        order.id,
        [{ productVariantId: variant.id, quantity: 1 }],
        expiresAt,
      );
      return reservations[0];
    });

    const consumed = await service.consume(result.id);

    const reservation = await prisma.inventoryReservation.findUniqueOrThrow({
      where: { id: result.id },
    });
    const ingredientAfter = await ingredientOf(ingredient.id);

    expect(consumed.status).toBe('CONSUMED');
    expect(reservation.status).toBe('CONSUMED');
    expect(ingredientAfter.stockQuantity).toBe(10);
    expect(ingredientAfter.version).toBe(1);
  });

  describe('two concurrent reservations for the last cup', () => {
    beforeAll(async () => {
      await prisma.$connect();

      const user = await prisma.user.create({
        data: {
          username: `inventory-${randomUUID()}`,
          passwordHash: 'integration-test-only',
        },
      });

      // Nguyên liệu chỉ đủ đúng 1 ly.
      const { product, variant, ingredient } = await createProduct('INV', 1);
      variantId = variant.id;
      ingredientId = ingredient.id;

      orderIds = await Promise.all(
        [1, 2].map(async () => {
          const order = await createOrder(
            prisma,
            'INV',
            user.id,
            product,
            variantId,
            new Date(Date.now() + 900000),
          );
          return order.id;
        }),
      );
    });

    it('allows only one to reserve the last cup', async () => {
      const results = await Promise.allSettled(
        orderIds.map((orderId) =>
          prisma.$transaction((tx) =>
            service.reserve(
              tx,
              orderId,
              [{ productVariantId: variantId, quantity: 1 }],
              new Date(Date.now() + 15 * 60 * 1000),
            ),
          ),
        ),
      );

      const successes = results.filter(
        (result) => result.status === 'fulfilled',
      );
      const failures = results.filter(
        (result) => result.status === 'rejected',
      );

      const ingredient = await ingredientOf(ingredientId);

      const reservations = await prisma.inventoryReservation.findMany({
        where: {
          orderId: { in: orderIds },
          productVariantId: variantId,
        },
      });

      expect(successes).toHaveLength(1);
      expect(failures).toHaveLength(1);
      expect(ingredient.stockQuantity).toBe(0);
      expect(ingredient.version).toBe(1);
      expect(reservations).toHaveLength(1);
      expect(reservations[0].status).toBe('ACTIVE');
    });
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });
});
