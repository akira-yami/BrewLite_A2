// Kiểm tra chuẩn hóa đầu vào và xử lý lỗi của API client coupon.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import ts from 'typescript';
import { readFileSync } from 'node:fs';

function loadCouponApi(auth) {
  const source = readFileSync(
    new URL('../../src/api/coupons.api.ts', import.meta.url),
    'utf8',
  );
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  });
  const compiledModule = { exports: {} };
  new Function('require', 'module', 'exports', outputText)(
    (name) => {
      assert.equal(name, '@/features/auth/api');
      return auth;
    },
    compiledModule,
    compiledModule.exports,
  );
  return compiledModule.exports;
}

test('coupon validation uses the authenticated API and trims surrounding whitespace', async () => {
  const requests = [];
  const api = loadCouponApi({
    AuthApiError: class AuthApiError extends Error {},
    authenticatedRequest: async (path, init) => {
      requests.push({ path, init });
      return { discountAmount: 15000, finalTotal: 85000 };
    },
  });

  assert.deepEqual(await api.validateCoupon('  WELCOME10  ', 100000), {
    discountAmount: 15000,
    finalTotal: 85000,
  });
  assert.equal(requests.length, 1);
  assert.equal(requests[0].path, '/coupons/validate');
  assert.deepEqual(JSON.parse(requests[0].init.body), { code: 'WELCOME10', subtotal: 100000 });
  assert.equal(new Headers(requests[0].init.headers).get('Content-Type'), 'application/json');
});

test('coupon API rejects missing code and invalid subtotal before making a request', async () => {
  let calls = 0;
  const api = loadCouponApi({
    AuthApiError: class AuthApiError extends Error {},
    authenticatedRequest: async () => {
      calls++;
      return { discountAmount: 1 };
    },
  });
  await assert.rejects(api.validateCoupon('   ', 100), (error) => error.code === 'COUPON_CODE_REQUIRED');
  await assert.rejects(api.validateCoupon('VALID', 0), (error) => error.code === 'INVALID_SUBTOTAL');
  assert.equal(calls, 0);
});

test('authenticated failures preserve HTTP status and business error code', async () => {
  class AuthApiError extends Error {
    constructor(message, status, code) {
      super(message);
      this.status = status;
      this.code = code;
    }
  }
  const api = loadCouponApi({
    AuthApiError,
    authenticatedRequest: async () => {
      throw new AuthApiError('Mã giảm giá không hợp lệ.', 422, 'COUPON_NOT_APPLICABLE');
    },
  });
  await assert.rejects(api.validateCoupon('INVALID', 100000), (error) => {
    assert.equal(error.status, 422);
    assert.equal(error.code, 'COUPON_NOT_APPLICABLE');
    assert.match(error.message, /không hợp lệ/);
    return true;
  });
});
