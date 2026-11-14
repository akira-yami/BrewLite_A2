// Kiểm tra xác thực và xử lý lỗi của API client đơn hàng/thanh toán.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import ts from 'typescript';

function setupModule(relPath, { token = 'current-token', response = { ok: true, status: 200, body: { data: {} } } } = {}) {
  const requests = [];
  const invalidated = [];
  const authSession = {
    getToken: () => token,
    invalidate: (val) => invalidated.push(val),
  };

  const fetch = async (url, init = {}) => {
    requests.push({ url, init });
    if (response instanceof Error) throw response;
    return {
      ...response,
      json: async () => response.body,
    };
  };

  function compile(targetRelPath) {
    const source = readFileSync(new URL(targetRelPath, import.meta.url), 'utf8');
    const { outputText } = ts.transpileModule(source, {
      compilerOptions: { module: ts.ModuleKind.CommonJS },
    });
    const compiledModule = { exports: {} };
    new Function('require', 'module', 'exports', 'fetch', outputText)(
      (name) => {
        if (name.includes('session')) return { authSession };
        if (name.includes('services/checkout.api')) return compile('../../src/services/checkout.api.ts');
        if (name.includes('auth/api')) return compile('../../src/features/auth/api.ts');
        if (name === '@/lib/api-client') return compile('../../src/lib/api-client.ts');
        throw new Error(`Unexpected require: ${name}`);
      },
      compiledModule,
      compiledModule.exports,
      fetch,
    );
    return compiledModule.exports;
  }

  return { mod: compile(relPath), requests, invalidated };
}

test('lib/api-client delegates to auth/api with brewlite_token and parses StandardErrorEnvelope message', async () => {
  const { mod, requests } = setupModule('../../src/lib/api-client.ts', {
    token: 'my-jwt-token',
    response: { ok: true, status: 200, body: { data: { valid: true } } },
  });

  await mod.authenticatedRequest('/api/v1/coupons/validate', {
    method: 'POST',
    body: JSON.stringify({ code: 'SALE10', subtotal: 50000 }),
  });
  assert.equal(new Headers(requests[0].init.headers).get('Authorization'), 'Bearer my-jwt-token');
  assert.equal(new Headers(requests[0].init.headers).get('Content-Type'), 'application/json');
  assert.match(requests[0].url, /\/api\/v1\/coupons\/validate$/);

  const failing = setupModule('../../src/lib/api-client.ts', {
    token: 'my-jwt-token',
    response: {
      ok: false,
      status: 422,
      statusText: 'Unprocessable Entity',
      body: {
        error: {
          code: 'COUPON_NOT_APPLICABLE',
          message: 'Mã giảm giá không tồn tại.',
        },
      },
    },
  });

  await assert.rejects(
    failing.mod.authenticatedRequest('/api/v1/coupons/validate', { method: 'POST' }),
    /Mã giảm giá không tồn tại/,
  );
});

test('orders/api invalidates session on 401 but preserves session on 403', async () => {
  const unauth = setupModule('../../src/features/orders/api.ts', {
    response: {
      ok: false,
      status: 401,
      body: { error: { code: 'UNAUTHORIZED', message: 'Hết hạn phiên' } },
    },
  });
  await assert.rejects(unauth.mod.getMyOrdersApi('expired-jwt'), (err) => err.status === 401);
  assert.deepEqual(unauth.invalidated, ['expired-jwt']);

  const forbidden = setupModule('../../src/features/orders/api.ts', {
    response: {
      ok: false,
      status: 403,
      body: { error: { code: 'FORBIDDEN_RESOURCE', message: 'Không có quyền' } },
    },
  });
  await assert.rejects(forbidden.mod.getMyOrdersApi('valid-jwt'), (err) => err.status === 403);
  assert.deepEqual(forbidden.invalidated, []);
});

test('payments/api invalidates session on 401 but preserves session on 403', async () => {
  const unauth = setupModule('../../src/features/payments/api.ts', {
    response: {
      ok: false,
      status: 401,
      body: { error: { code: 'UNAUTHORIZED', message: 'Hết hạn phiên' } },
    },
  });
  await assert.rejects(
    unauth.mod.createPaymentApi('expired-jwt', { orderId: 'o-1', method: 'E_WALLET' }, 'idem-1'),
    (err) => err.status === 401,
  );
  assert.deepEqual(unauth.invalidated, ['expired-jwt']);

  const forbidden = setupModule('../../src/features/payments/api.ts', {
    response: {
      ok: false,
      status: 403,
      body: { error: { code: 'FORBIDDEN_RESOURCE', message: 'Không có quyền' } },
    },
  });
  await assert.rejects(
    forbidden.mod.createPaymentApi('valid-jwt', { orderId: 'o-1', method: 'E_WALLET' }, 'idem-1'),
    (err) => err.status === 403,
  );
  assert.deepEqual(forbidden.invalidated, []);
});


for (const [method, payload, expected] of [
  ['validateCoupon', { code: 'SALE10', subtotal: 50000 }, { code: 'SALE10', discountAmount: 5000 }],
  ['processPayment', { orderId: 'order-1', method: 'E_WALLET' }, { success: true, isRetried: false, status: 'SUCCEEDED', gatewayTransactionId: 'GW-1' }],
]) {
  test(`CheckoutAPI.${method} returns the unwrapped checkout contract`, async () => {
    const { mod, requests } = setupModule('../../src/services/checkout.api.ts', {
      response: { ok: true, status: 200, body: { data: expected } },
    });
    const result = await mod.CheckoutAPI[method]('current-token', payload, 'idempotency-1');
    assert.deepEqual(result, expected);
    assert.equal(result.data, undefined);
    assert.deepEqual(JSON.parse(requests[0].init.body), payload);
    if (method === 'processPayment') assert.equal(new Headers(requests[0].init.headers).get('Idempotency-Key'), 'idempotency-1');
  });
}
