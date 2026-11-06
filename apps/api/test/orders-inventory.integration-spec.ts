import { PrismaPg } from '@prisma/adapter-pg';
import { randomUUID } from 'node:crypto';
import { PrismaClient } from '../src/generated/prisma/client.js';

import { OrdersRepository } from '../src/modules/orders/repositories/orders.repository.js';
import { OrdersService } from '../src/modules/orders/services/orders.service.js';

import { InventoryService } from '../src/modules/inventory/services/inventory.service.js';
import { InventoryRepository } from '../src/modules/inventory/repositories/inventory.repository.js';

import { CatalogRepository } from '../src/modules/catalog/repositories/catalog.repository.js';
import { CatalogService } from '../src/modules/catalog/services/catalog.service.js';

import { PromotionsRepository } from '../src/modules/promotions/repositories/promotions.repository.js';
import { PromotionsService } from '../src/modules/promotions/services/promotions.service.js';

import { UsersService } from '../src/modules/users/users.service.js';

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

describe('Orders -> Inventory integration', () => {
  const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString }),
  });

  const ordersRepository = new OrdersRepository(prisma as never);

  const catalogService = new CatalogService(
    new CatalogRepository(prisma as never),
  );

  const promotionsService = new PromotionsService(
    new PromotionsRepository(prisma as never),
  );

  const usersService = new UsersService();

  // Sử dụng InventoryService mới với Prisma và InventoryRepository.
  const inventoryRepository = new InventoryRepository({} as never);

  const inventoryService = new InventoryService(
    prisma as never,
    inventoryRepository,
  );

  const ordersService = new OrdersService(
    ordersRepository,
    prisma as never,
    promotionsService,
    catalogService,
    inventoryService,
    usersService,
  );

  beforeAll(async () => {
    await prisma.$connect();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  // Mỗi ly dùng 10g cà phê; kho có đủ nguyên liệu cho `cups` ly.
  const GRAMS_PER_CUP = 10;

  async function createFixture(cups: number) {
    const ingredient = await prisma.ingredient.create({
      data: {
        code: `OI-BEAN-${randomUUID()}`,
        name: 'Orders inventory coffee beans',
        unit: 'G',
        stockQuantity: cups * GRAMS_PER_CUP,
      },
    });

    const user = await prisma.user.create({
      data: {
        username: `orders-inventory-${randomUUID()}`,
        passwordHash: 'integration-test-only',
        role: 'CUSTOMER',
        isActive: true,
      },
    });

    const product = await prisma.product.create({
      data: {
        sku: `OI-${randomUUID()}`,
        name: 'Orders inventory integration product',
        imageUrl: '/orders-inventory-test.png',
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
      include: {
        variants: true,
      },
    });

    const variant = product.variants[0];

    if (!variant) {
      throw new Error('Integration fixture did not create a product variant');
    }

    return { user, variant, ingredient };
  }

  it('creates an order and reserves ingredients in the same transaction', async () => {
    const { user, variant, ingredient } = await createFixture(3);

    const order = await ordersService.createOrder(user.id, {
      items: [
        {
          productVariantId: variant.id,
          quantity: 2,
        },
      ],
    });

    const savedOrder = await prisma.order.findUniqueOrThrow({
      where: { id: order.id },
      include: {
        items: true,
        inventoryReservations: { include: { items: true } },
      },
    });

    const ingredientAfter = await prisma.ingredient.findUniqueOrThrow({
      where: { id: ingredient.id },
    });

    expect(savedOrder.items).toHaveLength(1);
    expect(savedOrder.items[0].quantity).toBe(2);

    expect(savedOrder.inventoryReservations).toHaveLength(1);
    expect(savedOrder.inventoryReservations[0].quantity).toBe(2);
    expect(savedOrder.inventoryReservations[0].status).toBe('ACTIVE');

    // Lượng nguyên liệu giữ cho reservation: 2 ly x 10g.
    expect(savedOrder.inventoryReservations[0].items).toMatchObject([
      { ingredientId: ingredient.id, quantity: 20 },
    ]);

    // 30g - 20g = 10g, đủ cho đúng 1 ly nữa.
    expect(ingredientAfter.stockQuantity).toBe(10);
    expect(ingredientAfter.version).toBe(1);
  });

  it('rolls back the order and stock when inventory reservation fails', async () => {
    const { user, variant, ingredient } = await createFixture(3);

    // Tạo repository riêng để chủ động gây lỗi khi tạo reservation.
    const failingInventoryRepository = new InventoryRepository({} as never);

    failingInventoryRepository.createReservation = async () => {
      throw new Error('Injected reservation creation failure');
    };

    const failingInventoryService = new InventoryService(
      prisma as never,
      failingInventoryRepository,
    );

    const failingOrdersService = new OrdersService(
      ordersRepository,
      prisma as never,
      promotionsService,
      catalogService,
      failingInventoryService,
      usersService,
    );

    const ordersBefore = await prisma.order.count({
      where: { userId: user.id },
    });

    await expect(
      failingOrdersService.createOrder(user.id, {
        items: [
          {
            productVariantId: variant.id,
            quantity: 2,
          },
        ],
      }),
    ).rejects.toThrow('Injected reservation creation failure');

    const ordersAfter = await prisma.order.count({
      where: { userId: user.id },
    });

    const ingredientAfter = await prisma.ingredient.findUniqueOrThrow({
      where: { id: ingredient.id },
    });

    const reservations = await prisma.inventoryReservation.findMany({
      where: { productVariantId: variant.id },
    });

    expect(ordersAfter).toBe(ordersBefore);
    expect(ingredientAfter.stockQuantity).toBe(30);
    expect(ingredientAfter.version).toBe(0);
    expect(reservations).toHaveLength(0);
  });
});
