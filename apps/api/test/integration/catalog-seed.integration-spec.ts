// Kiểm tra seed danh mục lặp lại và bảo toàn đơn, tồn kho, chỉnh sửa đã có.
import { PrismaPg } from '@prisma/adapter-pg';
import { randomUUID } from 'node:crypto';
import { seedMock } from '../../prisma/seed-mock.js';
import { seedCatalog } from '../../prisma/seed-catalog.js';
import { PrismaClient } from '../../src/generated/prisma/client.js';

const connectionString = process.env.SMOKE_DATABASE_URL;
if (
  !connectionString ||
  !new URL(connectionString).pathname
    .slice(1)
    .startsWith('brewlite_foundation_smoke')
) {
  throw new Error(
    'Seed tests require a disposable brewlite_foundation_smoke* database',
  );
}

describe('Non-destructive catalog seed', () => {
  const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString }),
  });
  let productId: string;
  let variantId: string;
  let toppingId: string;
  let orderId: string;
  const seededIngredientCodes = [
    'COFFEE_BEAN_CAU_DAT',
    'COLD_BREW_CONCENTRATE',
    'CONDENSED_MILK',
    'FRESH_MILK',
    'BLACK_TEA',
    'OOLONG_TEA',
    'PEACH_SYRUP',
    'ORANGE',
    'LEMONGRASS',
    'EGG_CREAM',
    'CUP_S',
    'CUP_M',
    'CUP_L',
    'PEARL_3Q',
    'JELLY_BOX',
    'FLAN_CUP',
    'TAPIOCA_STARCH',
    'BROWN_SUGAR',
    'CREAM_CHEESE',
    'WHIPPING_CREAM',
    'HONEY',
  ];
  const seededToppingCodes = [
    'TOP_PEARL',
    'TOP_JELLY',
    'TOP_FLAN',
    'TOP_BLACK_PEARL',
    'TOP_CHEESE',
    'TOP_ESPRESSO',
  ];

  beforeAll(async () => {
    const testSuffix = randomUUID();

const product = await prisma.product.create({
  data: {
    sku: `TEST-SEED-${testSuffix}`,
        name: 'Tên riêng',
        description: 'Mô tả riêng',
        imageUrl: '/custom.png',
        isActive: false,
        variants: {
          create: {
            size: 'M',
            price: 99000n,
            isActive: false,
          },
        },
      },
      include: { variants: true },
    });
    productId = product.id;
    variantId = product.variants[0].id;
    const topping = await prisma.topping.create({
  data: {
    code: `TEST-TOP-${testSuffix}`,
        name: 'Topping riêng',
        price: 9000n,
        isActive: false,
      },
    });
    toppingId = topping.id;
    await prisma.productTopping.create({ data: { productId, toppingId } });
    const user = await prisma.user.create({
      data: {
        username: `seed-${randomUUID()}`,
        passwordHash: 'test-only-hash',
      },
    });
    const expiresAt = new Date(Date.now() + 900000);
    const order = await prisma.order.create({
      data: {
        orderNumber: `SEED-${randomUUID().slice(0, 20)}`,
        userId: user.id,
        subtotal: 108000n,
        total: 108000n,
        reservationExpiresAt: expiresAt,
        items: {
          create: {
            productVariantId: variantId,
            productNameSnapshot: product.name,
            variantNameSnapshot: 'M',
            unitPrice: 99000n,
            quantity: 1,
            sugarLevel: 0,
            iceLevel: 25,
            note: 'Ghi chú cần giữ',
            orderItemToppings: {
              create: {
                toppingId,
                toppingNameSnapshot: topping.name,
                unitPrice: 9000n,
                quantity: 1,
              },
            },
          },
        },
        inventoryReservations: {
          create: { productVariantId: variantId, quantity: 1, expiresAt },
        },
      },
    });
    orderId = order.id;
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });

  const existing = async () => ({
    product: await prisma.product.findUniqueOrThrow({
      where: { id: productId },
    }),
    variant: await prisma.productVariant.findUniqueOrThrow({
      where: { id: variantId },
    }),
    topping: await prisma.topping.findUniqueOrThrow({
      where: { id: toppingId },
    }),
    order: await prisma.order.findUniqueOrThrow({
      where: { id: orderId },
      include: {
        items: { include: { orderItemToppings: true } },
        inventoryReservations: true,
      },
    }),
  });
  const catalog = async () => ({
    products: await prisma.product.findMany({
      where: {
        sku: {
          in: [
            'COFFEE-CAU-DAT-01',
            'COLD-BREW-ICE-02',
            'CAPPUCCINO-HEARTH-03',
            'TEA-PEACH-ORANGE-04',
            'TEA-OOLONG-EGG-05',
            'COFFEE-AMERICANO-06',
          ],
        },
      },
      orderBy: { sku: 'asc' },
      include: {
        variants: {
          orderBy: { size: 'asc' },
          include: { recipeItems: { orderBy: { ingredientId: 'asc' } } },
        },
        productToppings: { orderBy: { toppingId: 'asc' } },
      },
    }),
    ingredients: await prisma.ingredient.findMany({
      where: { code: { in: seededIngredientCodes } },
      orderBy: { code: 'asc' },
    }),
    toppings: await prisma.topping.findMany({
      where: { code: { in: seededToppingCodes } },
      orderBy: { code: 'asc' },
      include: { recipeItems: { orderBy: { ingredientId: 'asc' } } },
    }),
  });

  it('reports errors and rolls back partial catalog additions', async () => {
    const before = await catalog();
    const failing = prisma.$extends({
      query: {
        productVariant: {
          upsert() {
            throw new Error('Injected seed failure');
          },
        },
      },
    });
    await expect(
      seedCatalog(failing as unknown as PrismaClient),
    ).rejects.toThrow('Injected seed failure');
    expect(await catalog()).toEqual(before);
  });

  it('adds missing samples while preserving existing orders, reservations and catalog edits', async () => {
    const before = await existing();
    await seedCatalog(prisma);
    expect(await existing()).toEqual(before);
    const result = await catalog();
    expect(result.products).toHaveLength(6);
    expect(result.toppings).toHaveLength(seededToppingCodes.length);
    expect(result.products.flatMap((product) => product.variants)).toHaveLength(
      17,
    );
    expect(
      result.products.flatMap((product) => product.productToppings),
    ).toHaveLength(6 * seededToppingCodes.length);
    expect(result.ingredients).toHaveLength(seededIngredientCodes.length);
    // Mọi size bán được phải có công thức (BOM).
    const variants = result.products.flatMap((product) => product.variants);
    expect(variants.every((variant) => variant.recipeItems.length > 0)).toBe(
      true,
    );
    expect(variants.flatMap((variant) => variant.recipeItems)).toHaveLength(55);

    // Topping nhập sẵn có đúng 1 dòng công thức; topping chế biến có nhiều nguyên liệu.
    const byCode = new Map(result.toppings.map((t) => [t.code, t]));
    expect(byCode.get('TOP_PEARL')).toMatchObject({ type: 'PREPACKAGED' });
    expect(byCode.get('TOP_PEARL')?.recipeItems).toHaveLength(1);
    expect(byCode.get('TOP_PEARL')?.recipeItems[0].quantity).toBe(30);
    expect(byCode.get('TOP_BLACK_PEARL')).toMatchObject({ type: 'PREPARED' });
    expect(byCode.get('TOP_BLACK_PEARL')?.recipeItems.length).toBeGreaterThan(1);
    for (const topping of result.toppings) {
      expect(topping.recipeItems.length).toBeGreaterThan(0);
      if (topping.type === 'PREPACKAGED') {
        expect(topping.recipeItems).toHaveLength(1);
      }
    }
  });


  it('migrates the exact old sample image while preserving custom image edits', async () => {
    const sku = 'COFFEE-CAU-DAT-01';
    const legacy = 'https://images.unsplash.com/photo-1541167760496-1628856ab772?auto=format&fit=crop&w=800&q=80';
    await prisma.product.update({ where: { sku }, data: { imageUrl: legacy } });
    const before = await prisma.product.findUniqueOrThrow({ where: { sku }, include: { variants: true } });
    await seedCatalog(prisma);
    const after = await prisma.product.findUniqueOrThrow({ where: { sku }, include: { variants: true } });
    expect(after.imageUrl).toBe(`/products/${sku}.webp`);
    expect(after.id).toBe(before.id);
    expect(after.name).toBe(before.name);
    expect(after.variants).toEqual(before.variants);
    await prisma.product.update({ where: { sku }, data: { imageUrl: '/operator-custom.webp' } });
    await seedCatalog(prisma);
    expect((await prisma.product.findUniqueOrThrow({ where: { sku } })).imageUrl).toBe('/operator-custom.webp');
  });

  it('repeated runs preserve IDs, timestamps and ingredient stock without creating duplicates', async () => {
    // Tồn kho nguyên liệu do vận hành chỉnh sửa không được seed đặt lại.
    await prisma.ingredient.update({
      where: { code: 'COFFEE_BEAN_CAU_DAT' },
      data: { stockQuantity: 1234 },
    });
    const beforeCatalog = await catalog();
    const beforeExisting = await existing();
    await seedCatalog(prisma);
    expect(await catalog()).toEqual(beforeCatalog);
    expect(await existing()).toEqual(beforeExisting);
    expect(
      (
        await prisma.ingredient.findUniqueOrThrow({
          where: { code: 'COFFEE_BEAN_CAU_DAT' },
        })
      ).stockQuantity,
    ).toBe(1234);
  });
  it('retires legacy mock SKUs without deleting referenced history or touching other products', async () => {
    const old = await prisma.product.upsert({ where: { sku: 'MOCK-PROD-001' }, update: { isActive: true }, create: {
      sku: 'MOCK-PROD-001', name: 'Legacy demo', imageUrl: '/old.png', variants: { create: { size: 'M', price: 123n } },
    }, include: { variants: true } });
    const variant = old.variants[0];
    const protectedProduct = await prisma.product.upsert({ where: { sku: 'MOCK-PROD-031' }, update: {}, create: { sku: 'MOCK-PROD-031', name: 'Not legacy', imageUrl: '/custom.png' } });
    const item = await prisma.orderItem.create({ data: {
      orderId, productVariantId: variant.id, productNameSnapshot: old.name, variantNameSnapshot: 'M', unitPrice: 123n, quantity: 1,
    } });
    await seedMock(prisma);
    expect((await prisma.product.findUniqueOrThrow({ where: { id: old.id } })).isActive).toBe(false);
    expect((await prisma.productVariant.findUniqueOrThrow({ where: { id: variant.id } })).isActive).toBe(false);
    expect(await prisma.orderItem.findUniqueOrThrow({ where: { id: item.id } })).toEqual(item);
    expect(await prisma.product.findUniqueOrThrow({ where: { id: protectedProduct.id } })).toEqual(protectedProduct);
    const count = await prisma.product.count();
    await seedMock(prisma);
    expect(await prisma.product.count()).toBe(count);
    expect(await prisma.orderItem.findUniqueOrThrow({ where: { id: item.id } })).toEqual(item);
  });

});
