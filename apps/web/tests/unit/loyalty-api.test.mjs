// Kiểm tra đọc hạng thưởng, đổi điểm và chọn coupon bằng API client.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import ts from 'typescript';

function loadLoyaltyApi(authenticatedRequest, fetchImpl) {
  const source = readFileSync(new URL('../../src/features/loyalty/api.ts', import.meta.url), 'utf8');
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  });
  const compiledModule = { exports: {} };
  new Function('require', 'module', 'exports', 'fetch', 'process', outputText)(
    (name) => {
      assert.equal(name, '@/features/auth/api');
      return { authenticatedRequest };
    }, compiledModule, compiledModule.exports, fetchImpl, { env: {} },
  );
  return compiledModule.exports;
}

test('tiers are fetched publicly while overview uses authenticatedRequest', async () => {
  const calls = [];
  const tier = { tierId: '10000', pointsCost: 10000, discountAmount: 10000, minOrderValue: 20000 };
  const api = loadLoyaltyApi(async (path, init) => {
    calls.push({ path, init });
    return { pointsBalance: 9000, availableCoupons: [], transactions: [] };
  }, async (url, init) => {
    calls.push({ url, init });
    return { ok: true, json: async () => ({ data: [tier] }) };
  });
  assert.deepEqual(await api.getLoyaltyTiers(), [tier]);
  assert.deepEqual(await api.getLoyaltyOverview(), { pointsBalance: 9000, availableCoupons: [], transactions: [] });
  assert.match(calls[0].url, /\/loyalty\/tiers$/);
  assert.equal(calls[1].path, '/loyalty/me');
  assert.equal(calls[1].init.cache, 'no-store');
});

test('redemption includes tier body and Idempotency-Key header', async () => {
  let request;
  const api = loadLoyaltyApi(async (path, init) => {
    request = { path, init };
    return { coupon: { code: 'LYT-ABC' }, pointsUsed: 10000, pointsBalance: 5000 };
  }, async () => { throw new Error('tiers fetch should not be called'); });
  await api.redeemLoyalty('10000', '00000000-0000-4000-8000-000000000001');
  assert.equal(request.path, '/loyalty/redeem');
  assert.deepEqual(JSON.parse(request.init.body), { tierId: '10000' });
  assert.equal(new Headers(request.init.headers).get('Idempotency-Key'), '00000000-0000-4000-8000-000000000001');
});

test('quick redeem chooses the lowest affordable tier whose minimum subtotal is met', async () => {
  const source = readFileSync(new URL('../../src/features/loyalty/cart.ts', import.meta.url), 'utf8');
  const { outputText } = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } });
  const compiledModule = { exports: {} };
  new Function('require', 'module', 'exports', outputText)((name) => {
    assert.equal(name, './types');
    return {};
  }, compiledModule, compiledModule.exports);
  const tiers = [
    { tierId: '20000', pointsCost: 20000, discountAmount: 20000, minOrderValue: 40000 },
    { tierId: '10000', pointsCost: 10000, discountAmount: 10000, minOrderValue: 20000 },
  ];
  assert.equal(compiledModule.exports.chooseQuickRedeemTier(tiers, 25000, 40000).tierId, '10000');
  assert.equal(compiledModule.exports.chooseQuickRedeemTier(tiers, 9000, 40000), null);
  assert.equal(compiledModule.exports.chooseQuickRedeemTier(tiers, 25000, 19999), null);
});
