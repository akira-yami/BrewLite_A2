// Kiểm tra gộp, sửa, xóa và khôi phục món trong giỏ.
import assert from 'node:assert/strict';
import { test } from 'node:test';

const input = {
  product: { id: 'product', sku: 'COFFEE', name: 'Coffee', imageUrl: '/coffee.png' },
  variantId: 'variant', size: 'M', unitPrice: 40000, quantity: 1,
  toppings: [{ id: 'pearl', name: 'Pearl', price: 5000 }],
};
const storageKey = 'brewlite_cart_storage';
let moduleId = 0;

async function setup(storedItems = []) {
  const values = new Map([[storageKey, JSON.stringify(storedItems)]]);
  globalThis.window = {};
  globalThis.localStorage = {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
  };
  const { cartStore } = await import(`../../src/stores/cart-store.ts?test=${moduleId++}`);
  return { cartStore, read: () => JSON.parse(values.get(storageKey)) };
}

test('removing order items subtracts only ordered quantities and matching options', async () => {
  const { cartStore, read } = await setup();
  cartStore.addItem({ ...input, quantity: 2, note: 'Mang đi' });
  const orderItems = cartStore.getOrderItems();
  cartStore.addItem({ ...input, note: 'Mang đi' });
  cartStore.addItem({ ...input, note: 'Tại quán' });

  assert.equal(cartStore.removeOrderItems(orderItems), true);
  assert.deepEqual(read().map(({ quantity, note }) => ({ quantity, note })), [
    { quantity: 1, note: 'Mang đi' }, { quantity: 1, note: 'Tại quán' },
  ]);
});

test('different sugar/ice preferences stay separate; identical options merge without changing price', async () => {
  const { cartStore, read } = await setup();
  cartStore.addItem({ ...input, sugarLevel: 0, iceLevel: 50 });
  cartStore.addItem({ ...input, sugarLevel: 100, iceLevel: 50 });
  cartStore.addItem({ ...input, sugarLevel: 0, iceLevel: 0 });
  cartStore.addItem({ ...input, sugarLevel: 0, iceLevel: 50 });
  assert.equal(read().length, 3);
  assert.equal(read()[0].quantity, 2);
  assert.equal(read()[0].lineTotal, 90000);
  assert.equal(cartStore.getSnapshot().totalQuantity, 4);
  assert.equal(cartStore.getSnapshot().subtotal, 180000);
  assert.deepEqual(cartStore.getOrderItems()[0], {
    productVariantId: 'variant', quantity: 2, toppingIds: ['pearl'], sugarLevel: 0, iceLevel: 50, note: null,
  });
});

test('subtotal and totalQuantity recalculate after quantity and line changes', async () => {
  const { cartStore } = await setup();
  cartStore.addItem(input);
  cartStore.addItem({
    ...input,
    variantId: 'variant-large',
    size: 'L',
    unitPrice: 50000,
    quantity: 2,
    toppings: [],
  });

  assert.equal(cartStore.getSnapshot().totalQuantity, 3);
  assert.equal(cartStore.getSnapshot().subtotal, 145000);

  const firstId = cartStore.getSnapshot().items[0].id;
  cartStore.updateQuantity(firstId, 3);
  assert.equal(cartStore.getSnapshot().totalQuantity, 5);
  assert.equal(cartStore.getSnapshot().subtotal, 235000);
});

test('invalid quantities are rejected and leave the cart unchanged', async () => {
  const { cartStore } = await setup();
  assert.throws(() => cartStore.addItem({ ...input, quantity: 0 }), RangeError);
  assert.throws(() => cartStore.addItem({ ...input, quantity: 1.5 }), RangeError);
  assert.throws(() => cartStore.addItem({ ...input, quantity: Number.NaN }), RangeError);

  cartStore.addItem(input);
  const itemId = cartStore.getSnapshot().items[0].id;
  assert.throws(() => cartStore.updateQuantity(itemId, -1), RangeError);
  assert.throws(() => cartStore.updateQuantity(itemId, 21), RangeError);
  assert.equal(cartStore.getSnapshot().items[0].quantity, 1);

  cartStore.updateQuantity(itemId, 0);
  assert.equal(cartStore.getSnapshot().totalQuantity, 0);
  assert.equal(cartStore.getSnapshot().subtotal, 0);
});

test('omitted and null preferences merge, while explicit 100% remains separate', async () => {
  const { cartStore, read } = await setup();
  cartStore.addItem(input);
  cartStore.addItem({ ...input, sugarLevel: null, iceLevel: null });
  cartStore.addItem({ ...input, sugarLevel: 100, iceLevel: 100 });
  assert.equal(read().length, 2);
  assert.equal(read()[0].quantity, 2);
  assert.equal(read()[0].sugarLevel, null);
  assert.equal(read()[0].iceLevel, null);
  assert.equal(read()[0].note, null);
});

test('legacy carts retain quantities, migrate their identity and merge with new standard items', async () => {
  const legacy = {
    ...input, productId: 'product', id: 'product:variant:pearl',
    quantity: 2, name: 'Coffee', imageUrl: '/coffee.png', sku: 'COFFEE', lineTotal: 90000,
  };
  const { cartStore, read } = await setup([legacy]);
  cartStore.addItem(input);
  assert.equal(read().length, 1);
  assert.equal(read()[0].quantity, 3);
  assert.equal(read()[0].sugarLevel, null);
  assert.equal(read()[0].iceLevel, null);
  assert.equal(read()[0].note, null);
});

test('reload preserves zero preferences and quantity updates/removal address the correct item', async () => {
  const first = await setup();
  first.cartStore.addItem({ ...input, sugarLevel: 0, iceLevel: 0 });
  first.cartStore.addItem({ ...input, sugarLevel: 50, iceLevel: 50 });
  const reloaded = await setup(first.read());
  assert.equal(reloaded.cartStore.getOrderItems()[0].sugarLevel, 0);
  assert.equal(reloaded.cartStore.getOrderItems()[0].iceLevel, 0);
  reloaded.cartStore.updateQuantity(first.read()[0].id, 3);
  assert.equal(reloaded.read()[0].quantity, 3);
  reloaded.cartStore.removeItem(first.read()[0].id);
  assert.equal(reloaded.read().length, 1);
  assert.equal(reloaded.read()[0].sugarLevel, 50);
});

test('topping order does not change cart identity', async () => {
  const { cartStore, read } = await setup();
  const toppings = [...input.toppings, { id: 'cream', name: 'Cream', price: 7000 }];
  cartStore.addItem({ ...input, toppings, sugarLevel: 25, iceLevel: 75 });
  cartStore.addItem({ ...input, toppings: [...toppings].reverse(), sugarLevel: 25, iceLevel: 75 });
  assert.equal(read().length, 1);
  assert.equal(read()[0].quantity, 2);
});

test('different notes stay separate, identical trimmed notes merge and survive reload', async () => {
  const first = await setup();
  first.cartStore.addItem({ ...input, note: '  Để topping riêng  ' });
  first.cartStore.addItem({ ...input, note: 'Để topping riêng' });
  first.cartStore.addItem({ ...input, note: 'Không khuấy' });
  assert.equal(first.read().length, 2);
  assert.equal(first.read()[0].quantity, 2);
  assert.equal(first.read()[0].lineTotal, 90000);
  const reloaded = await setup(first.read());
  assert.equal(reloaded.cartStore.getOrderItems()[0].note, 'Để topping riêng');
  assert.equal(reloaded.cartStore.getOrderItems()[1].note, 'Không khuấy');
});

test('missing, null and whitespace-only notes merge as no note', async () => {
  const { cartStore, read } = await setup();
  for (const note of [undefined, null, '', ' \n ']) cartStore.addItem({ ...input, note });
  assert.equal(read().length, 1);
  assert.equal(read()[0].quantity, 4);
  assert.equal(cartStore.getOrderItems()[0].note, null);
});

test('notes with reserved delimiters and HTML are preserved as text', async () => {
  const { cartStore, read } = await setup();
  const note = '<b>riêng</b>:note=%:ice=0\nKhông khuấy';
  cartStore.addItem({ ...input, note });
  cartStore.addItem({ ...input, note: encodeURIComponent(note) });
  assert.equal(read().length, 2);
  assert.equal(cartStore.getOrderItems()[0].note, note);
});

test('arbitrary note text can be persisted without breaking cart identity', async () => {
  const { cartStore, read } = await setup();
  const note = 'Ghi chú \uD800';
  cartStore.addItem({ ...input, note });
  assert.equal(read()[0].note, note);
});

test('replacing a persisted item preserves preferences, note and price after reload', async () => {
  const first = await setup();
  first.cartStore.addItem(input);
  const storedItems = first.read();
  const edited = await setup(storedItems);
  edited.cartStore.replaceItem(storedItems[0].id, {
    ...input, quantity: 3, sugarLevel: 0, iceLevel: 25, note: '  Để topping riêng  ',
  });
  assert.equal(edited.read().length, 1);
  assert.equal(edited.read()[0].quantity, 3);
  assert.equal(edited.read()[0].lineTotal, 135000);
  const reloaded = await setup(edited.read());
  assert.deepEqual(reloaded.cartStore.getOrderItems()[0], {
    productVariantId: 'variant', quantity: 3, toppingIds: ['pearl'],
    sugarLevel: 0, iceLevel: 25, note: 'Để topping riêng',
  });
});

test('replacement merges with matching normalized options and keeps different options separate', async () => {
  const { cartStore, read } = await setup();
  cartStore.addItem(input);
  cartStore.addItem({ ...input, quantity: 2, sugarLevel: 0, iceLevel: 50, note: 'Riêng' });
  cartStore.addItem({ ...input, sugarLevel: 100, iceLevel: 50, note: 'Riêng' });
  cartStore.replaceItem(read()[0].id, {
    ...input, quantity: 3, sugarLevel: 0, iceLevel: 50, note: '  Riêng  ',
  });
  assert.equal(read().length, 2);
  assert.equal(read()[0].quantity, 5);
  assert.equal(read()[0].lineTotal, 225000);
  assert.equal(read()[1].sugarLevel, 100);
  assert.equal(read()[1].quantity, 1);
});
