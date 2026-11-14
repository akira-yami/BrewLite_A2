// Kiểm tra giao diện tích điểm của khách vãng lai và khách đã đăng nhập.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import ts from 'typescript';

const require = createRequire(import.meta.url);

function renderPage(snapshot) {
  const source = readFileSync(new URL('../../src/app/loyalty/page.tsx', import.meta.url), 'utf8');
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
  });
  const tiers = [
    { tierId: '10000', pointsCost: 10000, discountAmount: 10000, minOrderValue: 20000 },
  ];
  const overview = {
    pointsBalance: 12000,
    availableCoupons: [{ code: 'LYT-ABC', discountAmount: 10000, minOrderValue: 20000, endsAt: '2026-12-01T00:00:00.000Z' }],
    transactions: [{ type: 'EARN', points: 12000, balanceAfter: 12000, reason: 'Tích điểm', orderNumber: null, createdAt: '2026-11-01T00:00:00.000Z' }],
  };
  let stateIndex = 0;
  const mocks = {
    'next/link': { __esModule: true, default: ({ href, children }) => React.createElement('a', { href }, children) },
    'next/navigation': { useRouter: () => ({ push() {} }) },
    '@/features/auth/api': { AuthApiError: class AuthApiError extends Error {}, getMeApi: async () => ({}) },
    '@/features/auth/session': { authSession: { restore: async () => {} } },
    '@/features/auth/use-auth-session': { useAuthSession: () => snapshot },
    '@/features/loyalty/api': { getLoyaltyOverview: async () => overview, getLoyaltyTiers: async () => tiers, redeemLoyalty: async () => ({}) },
    '@/features/checkout/session': { readPendingLoyaltyRedeem: () => null, writePendingLoyaltyRedeem() {}, writePreferredLoyaltyCoupon() {} },
    '@/stores/cart-store': { formatVnd: (amount) => `${amount}đ` },
    react: {
      ...React,
      useState(initial) {
        stateIndex++;
        if (stateIndex === 1) return [tiers, () => {}];
        if (stateIndex === 2) return [overview, () => {}];
        return [initial, () => {}];
      },
      useEffect() {},
      useCallback(callback) { return callback; },
    },
  };
  const compiledModule = { exports: {} };
  new Function('require', 'module', 'exports', outputText)(
    (name) => mocks[name] ?? require(name), compiledModule, compiledModule.exports,
  );
  return renderToStaticMarkup(React.createElement(compiledModule.exports.default));
}

test('guest sees public reward tiers without personal balance, coupons, or history', () => {
  const html = renderPage({ status: 'anonymous', user: null });
  assert.match(html, /Các gói thưởng/);
  assert.match(html, /Đăng nhập/);
  assert.doesNotMatch(html, /Voucher của bạn|Lịch sử điểm|12\.000 điểm/);
});

test('customer sees balance, owned voucher, and points history', () => {
  const html = renderPage({ status: 'authenticated', user: { id: 'u1', role: 'CUSTOMER', loyaltyBalance: 12000 } });
  assert.match(html, /12\.000 điểm/);
  assert.match(html, /LYT-ABC/);
  assert.match(html, /Tích điểm/);
  assert.match(html, /Dùng voucher/);
});
