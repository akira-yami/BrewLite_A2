// Kiểm tra tùy chọn, công thức và dữ liệu món trong hộp thoại chi tiết.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { test } from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import ts from 'typescript';

const require = createRequire(import.meta.url);
const source = readFileSync(new URL('../../src/features/catalog/components/ProductDetailModal.tsx', import.meta.url), 'utf8');
const { outputText, diagnostics } = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
  reportDiagnostics: true,
});
const componentModule = { exports: {} };
const load = (name) => {
  if (name === 'next/image') return { __esModule: true, default: ({ src, alt }) => React.createElement('img', { src, alt }) };
  if (name === '@/stores/cart-store') return { cartStore: {}, formatVnd: (value) => `${value.toLocaleString('vi-VN')} đ` };
  return require(name);
};

const product = {
  id: 'coffee', sku: 'COFFEE', name: 'Coffee', description: 'Fresh coffee', imageUrl: '/coffee.png', basePrice: 30000,
  variants: [{ id: 'small', size: 'S', price: 30000, available: true }, { id: 'medium', size: 'M', price: 40000, available: true }],
  toppings: [{ id: 'api-pearl-id', code: 'PEARL', name: 'Pearl from API', price: 5000, available: true }],
};

function render(props) {
  assert.equal(diagnostics.length, 0, 'The product modal must contain valid TSX');
  new Function('require', 'module', 'exports', outputText)(load, componentModule, componentModule.exports);
  return renderToStaticMarkup(React.createElement(componentModule.exports.ProductDetailModal, { product, onClose() {}, ...props }));
}

test('modal uses product toppings from the API and hides topping choices when none exist', () => {
  assert.match(render(), /Pearl from API/);
  const plain = render({ product: { ...product, toppings: [] } });
  assert.match(plain, /Size S/);
  assert.match(plain, /Size M/);
  assert.doesNotMatch(plain, /Topping thêm:/);
});

test('editing opens with the saved size, quantity, zero sugar, ice and note', () => {
  const html = render({ editingItem: {
    id: 'saved-item', variantId: 'small', quantity: 3, sugarLevel: 0, iceLevel: 25,
    note: 'Để topping riêng', toppings: [product.toppings[0]],
  } });
  assert.match(html, /Lưu thay đổi/);
  assert.match(html, /Để topping riêng<\/textarea>/);
  assert.match(html, /aria-pressed="true"[^>]*>[\s\S]*?<span>0%<\/span>/);
  assert.match(html, /aria-pressed="true"[^>]*>[\s\S]*?<span>25%<\/span>/);
  assert.match(html, /105\.000 đ/);
});

test('new product starts with the standard recipe and an empty note', () => {
  const html = render();
  assert.equal((html.match(/value="standard" selected=""/g) ?? []).length, 2);
  assert.match(html, /Thêm vào giỏ/);
  assert.match(html, /<textarea[^>]*><\/textarea>/);
  assert.equal(render({ product: null }), '');
});

test('editing standard items retains the recipe and exposes percentage and quantity controls', () => {
  const html = render({ editingItem: {
    id: 'standard-item', variantId: 'small', quantity: 2, sugarLevel: null, iceLevel: null,
    note: '', toppings: [],
  } });
  assert.equal((html.match(/aria-pressed="true"/g) ?? []).length, 2);
  assert.equal((html.match(/Theo công thức chuẩn/g) ?? []).length, 2);
  assert.match(html, /30%/);
  assert.match(html, /70%/);
  assert.match(html, /Số lượng/);
  assert.match(html, /60\.000 đ/);
});

test('sizes show recipe availability instead of independent finished-drink stock counts', () => {
  const html = render({ product: { ...product, variants: [
    { id: 'small', size: 'S', price: 30000, available: true },
    { id: 'medium', size: 'M', price: 40000, available: false },
  ] } });
  assert.doesNotMatch(html, /Còn \d+/);
  assert.match(html, /Có thể pha/);
  assert.match(html, /Tạm hết nguyên liệu/);
  assert.match(html, /disabled=""[^>]*>[\s\S]*?Size M/);
});
