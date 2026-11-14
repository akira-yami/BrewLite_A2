// Kiểm tra schema PostgreSQL, khóa ngoại, CHECK và tính duy nhất sau migration.
import { PrismaPg } from '@prisma/adapter-pg';
import { randomUUID } from 'node:crypto';
import { PrismaClient } from '../../src/generated/prisma/client.js';
import { PaymentMethod } from '../../src/modules/payments/dto/create-payment.dto.js';
import { PaymentStatus } from '../../src/modules/payments/dto/payment-response.dto.js';

const connectionString = process.env.SMOKE_DATABASE_URL;
if (!connectionString || !new URL(connectionString).pathname.slice(1).startsWith('brewlite_foundation_smoke')) {
  throw new Error('Integration tests require SMOKE_DATABASE_URL pointing to brewlite_foundation_smoke*');
}

describe('Foundation on migrated PostgreSQL', () => {
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
  let userId: string;
  let variantId: string;
  let ingredientId: string;
  let orderId: string;
  const payment = () => ({
    orderId, idempotencyKey: randomUUID(), requestHash: 'a'.repeat(64),
    method: PaymentMethod.CARD, amount: 40000n,
  });

  beforeAll(async () => {
    await prisma.$connect();
    const user = await prisma.user.create({ data: { username: `smoke-${randomUUID()}`, passwordHash: 'test-hash' } });
    userId = user.id;
    const product = await prisma.product.create({ data: {
      sku: randomUUID(), name: 'Smoke product', imageUrl: '/smoke.png',
      variants: { create: { size: 'M', price: 40000n } },
    }, include: { variants: true } });
    variantId = product.variants[0].id;
    const ingredient = await prisma.ingredient.create({ data: {
      code: `SMOKE-${randomUUID().slice(0, 20)}`, name: 'Smoke coffee beans', unit: 'G', stockQuantity: 100,
    } });
    ingredientId = ingredient.id;
    await prisma.recipeItem.create({ data: { productVariantId: variantId, ingredientId, quantity: 10 } });
    const order = await prisma.order.create({ data: {
      orderNumber: `SMOKE-${randomUUID().slice(0, 20)}`, userId,
      subtotal: 40000n, total: 40000n, reservationExpiresAt: new Date(Date.now() + 900000),
      items: { create: { productVariantId: variantId, productNameSnapshot: product.name, variantNameSnapshot: 'M', unitPrice: 40000n, quantity: 1 } },
      statusHistories: { create: { toStatus: 'PENDING' } },
    } });
    orderId = order.id;
  });
  afterAll(async () => { await prisma.$disconnect(); });

  it('supports customer, barista and payment operator accounts; the gateway is not an account role', async () => {
    const roles = await prisma.$queryRaw<Array<{ role: string }>>`
      SELECT e.enumlabel AS role FROM pg_enum e
      JOIN pg_type t ON t.oid = e.enumtypid
      WHERE t.typname = 'UserRole' ORDER BY e.enumsortorder
    `;
    expect(roles.map(row => row.role)).toEqual(['CUSTOMER', 'BARISTA', 'PAYMENT_OPERATOR']);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: userId } })).role).toBe('CUSTOMER');
    const barista = await prisma.user.create({ data: {
      username: `barista-${randomUUID()}`, passwordHash: 'test-hash', role: 'BARISTA',
    } });
    expect(barista.role).toBe('BARISTA');
  });

  it('has all 27 domain tables and the default ingredient version', async () => {
    const tables = await prisma.$queryRaw<Array<{ tablename: string }>>`SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`;
    expect(tables.map(t => t.tablename).sort()).toEqual([
      'users', 'products', 'product_variants', 'toppings', 'product_toppings', 'orders',
      'order_items', 'order_item_toppings', 'payments', 'order_status_histories',
      'inventory_reservations', 'coupons', 'coupon_redemptions', 'loyalty_transactions',
      'ingredients', 'recipe_items', 'inventory_reservation_items', 'topping_recipe_items',
      'payment_recovery_requests', 'payment_recovery_audits', 'payment_recovery_resolutions',
      'sla_documents', 'sla_approval_workflows', 'sla_approvals', 'sla_review_feedback',
      'sla_metrics_validations', 'sla_test_evidence',
    ].sort());
    expect((await prisma.ingredient.findUniqueOrThrow({ where: { id: ingredientId } })).version).toBe(0);
  });

  it('never stores finished-drink quantities on products or variants', async () => {
    const columns = await prisma.$queryRaw<Array<{ table_name: string; column_name: string }>>`
      SELECT table_name, column_name FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name IN ('products', 'product_variants')
        AND column_name IN ('stock', 'quantity', 'version')
    `;
    expect(columns).toEqual([]);
  });

  it('rejects negative ingredient stock, non-positive recipe quantities, invalid order totals and zero item quantities', async () => {
    await expect(prisma.ingredient.update({ where: { id: ingredientId }, data: { stockQuantity: -1 } })).rejects.toThrow();
    await expect(prisma.recipeItem.update({
      where: { productVariantId_ingredientId: { productVariantId: variantId, ingredientId } },
      data: { quantity: 0 },
    })).rejects.toThrow();
    await expect(prisma.order.update({ where: { id: orderId }, data: { total: 1n } })).rejects.toThrow();
    await expect(prisma.orderItem.updateMany({ where: { orderId }, data: { quantity: 0 } })).rejects.toThrow();
    expect((await prisma.ingredient.findUniqueOrThrow({ where: { id: ingredientId } })).stockQuantity).toBe(100);
  });

  it('stores toppings as prepackaged (one portion = one ingredient quantity) or prepared (several ingredients)', async () => {
    const pearl = await prisma.topping.create({ data: {
      code: `SMOKE-TOP-${randomUUID().slice(0, 16)}`, name: 'Pearl 3Q', price: 8000n,
      recipeItems: { create: { ingredientId, quantity: 30 } },
    } });
    expect(pearl.type).toBe('PREPACKAGED');
    const second = await prisma.ingredient.create({ data: {
      code: `SMOKE-SUGAR-${randomUUID().slice(0, 16)}`, name: 'Brown sugar', unit: 'G', stockQuantity: 500,
    } });
    const prepared = await prisma.topping.create({ data: {
      code: `SMOKE-TOP-${randomUUID().slice(0, 16)}`, name: 'Black pearl', price: 9000n, type: 'PREPARED',
      recipeItems: { create: [{ ingredientId, quantity: 20 }, { ingredientId: second.id, quantity: 15 }] },
    } });
    expect(await prisma.toppingRecipeItem.count({ where: { toppingId: prepared.id } })).toBe(2);
    await expect(prisma.toppingRecipeItem.update({
      where: { toppingId_ingredientId: { toppingId: pearl.id, ingredientId } },
      data: { quantity: 0 },
    })).rejects.toThrow();
    await expect(prisma.toppingRecipeItem.create({ data: { toppingId: pearl.id, ingredientId, quantity: 5 } })).rejects.toMatchObject({ code: 'P2002' });
  });

  it('allows one recipe line per variant and ingredient', async () => {
    await expect(prisma.recipeItem.create({ data: { productVariantId: variantId, ingredientId, quantity: 5 } })).rejects.toMatchObject({ code: 'P2002' });
  });

  it('preserves nullable preferences and stores both percentage boundaries', async () => {
    const items = await prisma.orderItem.findMany({ where: { orderId } });
    expect(items[0]).toMatchObject({ sugarLevel: null, iceLevel: null });
    for (const levels of [{ sugarLevel: 0, iceLevel: 100 }, { sugarLevel: 100, iceLevel: 0 }]) {
      await prisma.orderItem.updateMany({ where: { orderId }, data: levels });
      expect((await prisma.orderItem.findMany({ where: { orderId } }))[0]).toMatchObject(levels);
    }
    await prisma.orderItem.updateMany({ where: { orderId }, data: { sugarLevel: null, iceLevel: null } });
  });

  it('rejects sugar/ice levels outside 0..100 at the database layer', async () => {
    for (const field of ['sugarLevel', 'iceLevel'] as const) {
      for (const value of [-1, 101]) {
        await expect(prisma.orderItem.updateMany({ where: { orderId }, data: { [field]: value } })).rejects.toThrow();
      }
    }
  });

  it('stores optional notes and rejects more than 500 characters', async () => {
    expect((await prisma.orderItem.findMany({ where: { orderId } }))[0].note).toBeNull();
    for (const note of ['Để topping riêng', 'a'.repeat(500)]) {
      await prisma.orderItem.updateMany({ where: { orderId }, data: { note } });
      expect((await prisma.orderItem.findMany({ where: { orderId } }))[0].note).toBe(note);
    }
    await expect(prisma.orderItem.updateMany({ where: { orderId }, data: { note: 'a'.repeat(501) } })).rejects.toThrow();
    await prisma.orderItem.updateMany({ where: { orderId }, data: { note: null } });
  });

  it('rejects invalid coupon percentage and time window', async () => {
    const coupon = { code: randomUUID(), discountType: 'PERCENTAGE' as const, discountValue: 101n,
      startsAt: new Date('2026-10-01T00:00:00Z'), endsAt: new Date('2026-11-01T00:00:00Z') };
    await expect(prisma.coupon.create({ data: coupon })).rejects.toThrow();
    await expect(prisma.coupon.create({ data: { ...coupon, discountValue: 10n, endsAt: coupon.startsAt } })).rejects.toThrow();
  });

  it('allows failed attempts but only one successful payment and one idempotency key', async () => {
    await prisma.payment.create({ data: { ...payment(), status: PaymentStatus.FAILED } });
    const succeeded = await prisma.payment.create({ data: { ...payment(), status: PaymentStatus.SUCCEEDED } });
    expect({ method: succeeded.method, status: succeeded.status }).toEqual({ method: 'CARD', status: 'SUCCEEDED' });
    await expect(prisma.payment.create({ data: { ...payment(), status: PaymentStatus.SUCCEEDED } })).rejects.toThrow();
    await expect(prisma.payment.create({ data: { ...payment(), idempotencyKey: succeeded.idempotencyKey } })).rejects.toMatchObject({ code: 'P2002' });
    expect(await prisma.payment.count({ where: { orderId, status: 'SUCCEEDED' } })).toBe(1);
  });

  it('allows only one EARN per order and preserves a reversal', async () => {
    await prisma.loyaltyTransaction.create({ data: { userId, orderId, type: 'EARN', points: 4, balanceAfter: 4, reason: 'smoke' } });
    await expect(prisma.loyaltyTransaction.create({ data: { userId, orderId, type: 'EARN', points: 4, balanceAfter: 8, reason: 'duplicate' } })).rejects.toMatchObject({ code: 'P2002' });
    await prisma.loyaltyTransaction.create({ data: { userId, orderId, type: 'REVERSAL', points: -4, balanceAfter: 0, reason: 'smoke reversal' } });
    expect(await prisma.loyaltyTransaction.count({ where: { orderId } })).toBe(2);
  });

  it('enforces foreign keys and rolls back the whole transaction on a CHECK violation', async () => {
    await expect(prisma.inventoryReservation.create({ data: { orderId, productVariantId: randomUUID(), quantity: 1, expiresAt: new Date() } })).rejects.toMatchObject({ code: 'P2003' });
    const before = await prisma.ingredient.findUniqueOrThrow({ where: { id: ingredientId } });
    await expect(prisma.$transaction(async tx => {
      await tx.ingredient.update({ where: { id: ingredientId }, data: { stockQuantity: { decrement: 10 }, version: { increment: 1 } } });
      await tx.order.update({ where: { id: orderId }, data: { discountAmount: 50000n } });
    })).rejects.toThrow();
    const after = await prisma.ingredient.findUniqueOrThrow({ where: { id: ingredientId } });
    expect({ stock: after.stockQuantity, version: after.version }).toEqual({ stock: before.stockQuantity, version: before.version });
  });
});
