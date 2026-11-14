// Kiểm tra lưu và khôi phục coupon và lượt thanh toán của checkout.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import ts from 'typescript';
import { readFileSync } from 'node:fs';

function loadSession() {
  const source = readFileSync(
    new URL('../../src/features/checkout/session.ts', import.meta.url),
    'utf8',
  );
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  });
  const compiledModule = { exports: {} };
  new Function('module', 'exports', outputText)(compiledModule, compiledModule.exports);
  return compiledModule.exports;
}

function makeStorage() {
  const values = new Map();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key),
  };
}

test('coupon quote survives route changes and rejects an invalid discount', () => {
  const session = loadSession();
  const storage = makeStorage();
  const quote = { code: 'WELCOME10', subtotal: 100000, discountAmount: 10000 };

  session.writeCheckoutCoupon(storage, quote);
  assert.deepEqual(session.readCheckoutCoupon(storage), quote);

  storage.setItem('brewlite_checkout_coupon', JSON.stringify({
    code: 'WELCOME10',
    subtotal: 100000,
    discountAmount: 150000,
  }));
  assert.equal(session.readCheckoutCoupon(storage), null);
  assert.equal(storage.getItem('brewlite_checkout_coupon'), null);
});

test('preferred Loyalty coupon survives navigation and is removed when cleared', () => {
  const session = loadSession();
  const storage = makeStorage();
  session.writePreferredLoyaltyCoupon(storage, 'LYT-ABC123');
  assert.equal(session.readPreferredLoyaltyCoupon(storage), 'LYT-ABC123');
  session.writePreferredLoyaltyCoupon(storage, null);
  assert.equal(session.readPreferredLoyaltyCoupon(storage), null);
});

test('pending Loyalty redemption key is stable per customer and tier', () => {
  const session = loadSession();
  const storage = makeStorage();
  const key = '00000000-0000-4000-8000-000000000001';
  session.writePendingLoyaltyRedeem(storage, 'customer-1', '10000', key);
  assert.equal(session.readPendingLoyaltyRedeem(storage, 'customer-1', '10000'), key);
  assert.equal(session.readPendingLoyaltyRedeem(storage, 'customer-1', '20000'), null);
  session.writePendingLoyaltyRedeem(storage, 'customer-1', '10000', null);
  assert.equal(session.readPendingLoyaltyRedeem(storage, 'customer-1', '10000'), null);
});

test('pending payment attempt survives reload with order, key and method unchanged', () => {
  const session = loadSession();
  const storage = makeStorage();
  const pending = {
    orderId: 'order-123',
    idempotencyKey: 'attempt-key-123',
    method: 'CARD',
    cartFingerprint: '[{"productVariantId":"variant-1","quantity":1}]',
  };

  session.writePendingCheckout(storage, pending);
  assert.deepEqual(session.readPendingCheckout(storage), pending);
});

test('confirmed failure rotates only the key and preserves the existing order for retry', () => {
  const session = loadSession();
  const storage = makeStorage();
  const failed = {
    orderId: 'order-123',
    idempotencyKey: null,
    method: null,
    cartFingerprint: '[{"productVariantId":"variant-1","quantity":1}]',
  };

  session.writePendingCheckout(storage, failed);
  assert.deepEqual(session.readPendingCheckout(storage), failed);
});

test('incomplete pending key/method state is discarded', () => {
  const session = loadSession();
  const storage = makeStorage();
  storage.setItem('brewlite_pending_checkout', JSON.stringify({
    orderId: 'order-123',
    idempotencyKey: 'key-without-method',
    method: null,
    cartFingerprint: 'cart-fingerprint',
  }));
  assert.equal(session.readPendingCheckout(storage), null);
  assert.equal(storage.getItem('brewlite_pending_checkout'), null);
});

test('confirmed payment success clears the pending checkout attempt', () => {
  const { transitionPaymentAttempt } = loadSession();
  const attempt = {
    orderId: 'order-success',
    idempotencyKey: 'key-success',
    method: 'CARD',
    cartFingerprint: 'cart-fingerprint',
  };

  assert.equal(transitionPaymentAttempt(attempt, 'SUCCEEDED'), null);
});

test('confirmed payment failure rotates only the key and preserves the original order', () => {
  const { transitionPaymentAttempt } = loadSession();
  const attempt = {
    orderId: 'order-failed',
    idempotencyKey: 'key-failed',
    method: 'CARD',
    cartFingerprint: 'cart-fingerprint',
  };

  assert.deepEqual(transitionPaymentAttempt(attempt, 'FAILED'), {
    orderId: 'order-failed',
    idempotencyKey: null,
    method: null,
    cartFingerprint: 'cart-fingerprint',
  });
});

test('processing and unknown payment outcomes preserve the exact attempt for safe replay', () => {
  const { transitionPaymentAttempt } = loadSession();
  const attempt = {
    orderId: 'order-uncertain',
    idempotencyKey: 'key-must-not-rotate',
    method: 'E_WALLET',
    cartFingerprint: 'cart-fingerprint',
  };

  assert.deepEqual(transitionPaymentAttempt(attempt, 'PROCESSING'), attempt);
  assert.deepEqual(transitionPaymentAttempt(attempt, 'UNKNOWN'), attempt);
});


test('pending VNPay payment method and key survive reload', () => {
  const session = loadSession();
  const storage = makeStorage();
  const pending = {
    orderId: 'order-vnpay',
    idempotencyKey: 'vnpay-idempotency-key',
    method: 'VNPAY',
    cartFingerprint: 'cart-fingerprint',
  };
  session.writePendingCheckout(storage, pending);
  assert.deepEqual(session.readPendingCheckout(storage), pending);
});
