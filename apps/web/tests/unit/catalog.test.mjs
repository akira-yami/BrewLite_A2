// Kiểm tra lấy, chuyển đổi và định dạng dữ liệu danh mục.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fetchProducts, formatPrice } from '../../src/lib/catalog.ts';

test('formats prices in Vietnamese dong', () => {
  assert.match(formatPrice(25000), /25\.000/);
  assert.match(formatPrice(0), /0/);
});

test('loads catalog from the API envelope and normalizes the base URL', async t => {
  const data = [{ id: 'coffee', name: 'Coffee', description: '', basePrice: 25000 }];
  const controller = new AbortController();
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    assert.equal(url, 'http://localhost:3001/api/v1/products');
    assert.equal(options.signal, controller.signal);
    return Response.json({ success: true, data });
  });
  assert.deepEqual(await fetchProducts('http://localhost:3001/api/v1/', controller.signal), data);
});

test('supports an empty catalog', async t => {
  t.mock.method(globalThis, 'fetch', async () => Response.json({ success: true, data: [] }));
  assert.deepEqual(await fetchProducts('http://api'), []);
});

test('rejects HTTP errors instead of showing an empty menu', async t => {
  t.mock.method(globalThis, 'fetch', async () => new Response('', { status: 503 }));
  await assert.rejects(fetchProducts('http://api'), /Không tải được menu/);
});

test('rejects invalid envelopes and product data', async t => {
  for (const payload of [null, {}, { success: false, data: [] }, { success: true, data: [{}] },
    { success: true, data: [{ id: 'a', name: 'A', description: '', basePrice: -1 }] }]) {
    t.mock.method(globalThis, 'fetch', async () => Response.json(payload));
    await assert.rejects(fetchProducts('http://api'), /không hợp lệ/);
  }
});

test('propagates network failures for the retry state', async t => {
  t.mock.method(globalThis, 'fetch', async () => { throw new Error('network down'); });
  await assert.rejects(fetchProducts('http://api'), /network down/);
});
