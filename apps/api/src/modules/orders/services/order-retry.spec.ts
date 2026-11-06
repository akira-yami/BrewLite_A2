import { describe, expect, it, vi } from 'vitest';
import { CatalogService } from '../../catalog/services/catalog.service.js';
import { InventoryService } from '../../inventory/services/inventory.service.js';
import { InventoryRepository } from '../../inventory/repositories/inventory.repository.js';
import { UsersService } from '../../users/users.service.js';
import { OrdersService } from './orders.service.js';

// Công thức một dòng: mỗi ly dùng `quantity` đơn vị của `ingredientId`.
function recipe(
  ingredientId: string,
  quantity: number,
  stockQuantity: number,
  version = 7,
) {
  return [
    {
      ingredientId,
      quantity,
      ingredient: { id: ingredientId, stockQuantity, version, isActive: true },
    },
  ];
}

function setup() {
  const variant = {
    id: 'variant',
    size: 'M',
    price: 40000n,
    recipeItems: recipe('bean', 10, 100),
    product: { name: 'Coffee', productToppings: [] },
  };

  const tx = {
    user: {
      findFirst: vi.fn().mockResolvedValue({ id: 'user' }),
    },

    productVariant: {
      findFirst: vi.fn().mockResolvedValue(variant),
    },
    ingredient: {
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    },

    order: {
      create: vi.fn().mockImplementation(async ({ data }) => ({
        ...data,
        id: 'order',
        items: [],
        createdAt: new Date(),
      })),
    },

    inventoryReservation: {
      create: vi.fn(),
    },

    orderStatusHistory: {
      create: vi.fn(),
    },
  };

  const prisma = {
    $transaction: vi.fn(async (callback) => callback(tx)),
  };

  const catalog = new CatalogService({} as any);

  const inventory = new InventoryService(
    prisma as any,
    new InventoryRepository({} as never),
  );

  const service = new OrdersService(
    {} as any,
    prisma as any,
    {} as any,
    catalog,
    inventory,
    new UsersService(),
  );

  const dto = {
    items: [
      {
        productVariantId: 'variant',
        quantity: 1,
      },
    ],
  };

  return {
    service,
    tx,
    prisma,
    dto,
    variant,
  };
}

describe('Order transaction regression checks', () => {
  it('quotes and updates within the same Serializable transaction with the expected ingredient version', async () => {
    const { service, tx, prisma, dto } = setup();

    await service.createOrder('user', dto);
    expect(prisma.$transaction).toHaveBeenCalledWith(expect.any(Function), {
      isolationLevel: 'Serializable',
    });
    expect(tx.ingredient.updateMany).toHaveBeenCalledWith({
      where: {
        id: 'bean',
        version: 7,
        isActive: true,
        stockQuantity: { gte: 10 },
      },
      data: { stockQuantity: { decrement: 10 }, version: { increment: 1 } },
    });
  });

  it('re-quotes after a version conflict and snapshots the new price/version', async () => {
    const { service, tx, dto, variant } = setup();
    tx.ingredient.updateMany.mockResolvedValueOnce({ count: 0 });
    tx.productVariant.findFirst
      .mockResolvedValueOnce(variant)
      .mockResolvedValueOnce({
        ...variant,
        price: 45000n,
        recipeItems: recipe('bean', 10, 100, 8),
      });
    const response = await service.createOrder('user', dto);

    expect(response.total).toBe(45000);
    expect(tx.ingredient.updateMany).toHaveBeenLastCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          version: 8,
        }),
      }),
    );

    expect(tx.orderStatusHistory.create).toHaveBeenCalledTimes(1);
  });

  it.each(['P2034', '40001', '40P01'])(
    'retries a whole transaction after %s',
    async (code) => {
      const { service, prisma, dto } = setup();

      prisma.$transaction.mockRejectedValueOnce({
        code,
      });

      await service.createOrder('user', dto);

      expect(prisma.$transaction).toHaveBeenCalledTimes(2);
    },
  );

  it('regenerates a colliding order number within its database length limit', async () => {
    const { service, tx, dto } = setup();

    tx.order.create.mockRejectedValueOnce({
      code: 'P2002',
      meta: {
        target: ['order_number'],
      },
    });

    await service.createOrder('user', dto);

    const numbers = tx.order.create.mock.calls.map(
      ([args]) => args.data.orderNumber,
    );

    expect(new Set(numbers).size).toBe(2);

    expect(numbers.every((value) => value.length <= 30)).toBe(true);
  });

  it('stops after three version conflicts with INVENTORY_CONFLICT', async () => {
    const { service, tx, prisma, dto } = setup();
    tx.ingredient.updateMany.mockResolvedValue({ count: 0 });
    await expect(service.createOrder('user', dto)).rejects.toMatchObject({
      response: { error: { code: 'INVENTORY_CONFLICT' } },
    });

    expect(prisma.$transaction).toHaveBeenCalledTimes(3);
  });

  it('does not retry insufficient ingredients or an inactive principal', async () => {
    const { service, tx, prisma, dto, variant } = setup();
    // Còn 9g, mỗi ly cần 10g => làm được 0 ly.
    tx.productVariant.findFirst.mockResolvedValue({
      ...variant,
      recipeItems: recipe('bean', 10, 9),
    });
    await expect(service.createOrder('user', dto)).rejects.toMatchObject({
      response: {
        error: {
          code: 'OUT_OF_STOCK',
          details: [{ variantId: 'variant', available: false }],
        },
      },
    });

    expect(prisma.$transaction).toHaveBeenCalledTimes(1);

    tx.user.findFirst.mockResolvedValue(null);

    await expect(service.createOrder('user', dto)).rejects.toMatchObject({
      status: 401,
    });

    expect(tx.order.create).not.toHaveBeenCalled();
  });

  it('reserves ingredients in ID order with quantities aggregated across variants', async () => {
    const { service, tx, dto, variant } = setup();
    // Hai size dùng chung "bean"; "a-cup" chỉ thuộc variant a.
    tx.productVariant.findFirst.mockImplementation(async ({ where }) => ({
      ...variant,
      id: where.id,
      recipeItems:
        where.id === 'a'
          ? [...recipe('bean', 10, 100), ...recipe('a-cup', 1, 50)]
          : recipe('bean', 20, 100),
    }));
    dto.items = [
      {
        productVariantId: 'b',
        quantity: 1,
      },
      {
        productVariantId: 'a',
        quantity: 1,
      },
      {
        productVariantId: 'b',
        quantity: 2,
      },
    ];

    await service.createOrder('user', dto);

    expect(
      tx.ingredient.updateMany.mock.calls.map(([args]) => [
        args.where.id,
        args.data.stockQuantity.decrement,
      ]),
    ).toEqual([
      ['a-cup', 1],
      // a: 1 ly x 10 + b: 3 ly x 20 = 70.
      ['bean', 70],
    ]);
    expect(
      tx.inventoryReservation.create.mock.calls.map(
        ([args]) => args.data.productVariantId,
      ),
    ).toEqual(['a', 'b']);
  });
});
