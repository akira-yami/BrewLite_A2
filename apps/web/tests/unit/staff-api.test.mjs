// Kiểm tra client gọi hàng đợi nhân viên, cập nhật trạng thái và xử lý mã lỗi.
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
  const source = readFileSync(new URL('../../src/features/staff/api.ts', import.meta.url), 'utf8');
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

test('getStaffQueueApi sends the bearer token and unwraps data', async () => {
  const { api, requests } = setup({
    response: { ok: true, status: 200, body: { data: [{ id: 'o-1', status: 'PAID' }] } },
  });
  const result = await api.getStaffQueueApi('jwt-1');
  assert.deepEqual(result, [{ id: 'o-1', status: 'PAID' }]);
  assert.match(requests[0].url, /\/staff\/orders$/);
  assert.equal(requests[0].init.headers.Authorization, 'Bearer jwt-1');
});

test('getStaffQueueApi passes an optional status filter', async () => {
  const { api, requests } = setup({
    response: { ok: true, status: 200, body: { data: [] } },
  });
  await api.getStaffQueueApi('jwt-1', 'READY');
  assert.match(requests[0].url, /\/staff\/orders\?status=READY$/);
});

test('updateStaffOrderStatusApi PATCHes only the target status', async () => {
  const { api, requests } = setup({
    response: { ok: true, status: 200, body: { data: { id: 'o-1', status: 'PREPARING' } } },
  });
  const result = await api.updateStaffOrderStatusApi('jwt-1', 'o-1', 'PREPARING');
  assert.equal(result.status, 'PREPARING');
  assert.match(requests[0].url, /\/staff\/orders\/o-1\/status$/);
  assert.equal(requests[0].init.method, 'PATCH');
  assert.deepEqual(JSON.parse(requests[0].init.body), { status: 'PREPARING' });
});

test('401 invalidates the session; 403 and 409 keep it and expose the API message', async () => {
  const unauth = setup({
    response: { ok: false, status: 401, body: { error: { code: 'UNAUTHORIZED', message: 'Hết hạn' } } },
  });
  await assert.rejects(unauth.api.getStaffQueueApi('expired'), (e) => e.status === 401);
  assert.deepEqual(unauth.invalidated, ['expired']);

  const forbidden = setup({
    response: { ok: false, status: 403, body: { error: { code: 'FORBIDDEN_RESOURCE', message: 'Không có quyền' } } },
  });
  await assert.rejects(
    forbidden.api.getStaffQueueApi('customer-jwt'),
    (e) => e.status === 403 && e.code === 'FORBIDDEN_RESOURCE',
  );
  assert.deepEqual(forbidden.invalidated, []);

  const conflict = setup({
    response: {
      ok: false,
      status: 409,
      body: { error: { code: 'INVALID_ORDER_TRANSITION', message: 'Không thể chuyển đơn từ PAID sang COMPLETED.' } },
    },
  });
  await assert.rejects(
    conflict.api.updateStaffOrderStatusApi('jwt-1', 'o-1', 'COMPLETED'),
    (e) => e.status === 409 && e.code === 'INVALID_ORDER_TRANSITION' && /PAID sang COMPLETED/.test(e.message),
  );
  assert.deepEqual(conflict.invalidated, []);
});
