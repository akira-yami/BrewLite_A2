// Kiểm tra tìm kiếm, phân trang và xử lý lỗi của API client tồn kho.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import ts from 'typescript';

function setup({ response }) {
  const requests = [];
  const invalidated = [];
  const authSession = { invalidate: (token) => invalidated.push(token) };
  const fetch = async (url, init = {}) => {
    requests.push({ url, init });
    return { ...response, json: async () => response.body };
  };
  const source = readFileSync(new URL('../../src/features/staff/inventory-api.ts', import.meta.url), 'utf8');
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS },
  });
  const mod = { exports: {} };
  new Function('require', 'module', 'exports', 'fetch', outputText)(
    (name) => {
      if (name.includes('session')) return { authSession };
      throw new Error(`Unexpected require: ${name}`);
    },
    mod,
    mod.exports,
    fetch,
  );
  return { api: mod.exports, requests, invalidated };
}

test('inventory keeps nextCursor metadata and passes search/filter/cursor safely', async () => {
  const { api, requests } = setup({ response: { ok: true, status: 200, body: { data: [{ id: 'bean' }], meta: { nextCursor: 'next' } } } });
  const page = await api.getInventoryApi('staff', { q: 'cà phê & sữa', status: 'LOW_STOCK', cursor: 'previous' });
  assert.equal(page.meta.nextCursor, 'next');
  const query = new URL(requests[0].url).searchParams;
  assert.equal(query.get('q'), 'cà phê & sữa');
  assert.equal(query.get('status'), 'LOW_STOCK');
  assert.equal(query.get('cursor'), 'previous');
  assert.equal(requests[0].init.headers.Authorization, 'Bearer staff');
});


test('inventory list expires session on 401 and rejects a malformed success body', async () => {
  const unauth = setup({ response: { ok: false, status: 401, body: {} } });
  await assert.rejects(unauth.api.getInventoryApi('old'), e => e.status === 401);
  assert.deepEqual(unauth.invalidated, ['old']);
  const invalid = setup({ response: { ok: true, status: 200, body: { data: {} } } });
  await assert.rejects(invalid.api.getInventoryApi('staff'));
});

test('inventory rejects missing pagination metadata before rendering', async () => {
  const invalid = setup({ response: { ok: true, status: 200, body: { data: [] } } });
  await assert.rejects(invalid.api.getInventoryApi('staff'));
});
