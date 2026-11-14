// Kiểm tra gửi JWT, xác thực và xử lý phản hồi lỗi.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import ts from 'typescript';

function setup(response, { token = 'current-token', jsonFails = false } = {}) {
  const requests = [];
  const invalidated = [];
  const authSession = {
    getToken: () => token,
    invalidate: (value) => invalidated.push(value),
  };
  const { outputText } = ts.transpileModule(
    readFileSync(
      new URL('../../src/features/auth/api.ts', import.meta.url),
      'utf8',
    ),
    {
      compilerOptions: { module: ts.ModuleKind.CommonJS },
    },
  );
  const compiledModule = { exports: {} };
  const fetch = async (url, init) => {
    requests.push({ url, init });
    if (response instanceof Error) throw response;
    return {
      ...response,
      json: async () => {
        if (jsonFails) throw new Error('not JSON');
        return response.body;
      },
    };
  };
  new Function('require', 'module', 'exports', 'fetch', outputText)(
    (name) => {
      assert.match(name, /session/);
      return { authSession };
    },
    compiledModule,
    compiledModule.exports,
    fetch,
  );
  return { api: compiledModule.exports, requests, invalidated };
}

test('Gửi JWT khi đọc hồ sơ và không lưu cache dữ liệu riêng', async () => {
  const { api, requests } = setup({
    ok: true,
    status: 200,
    body: { data: { username: 'huy' } },
  });
  assert.deepEqual(await api.getMeApi('token'), { username: 'huy' });
  assert.equal(
    new Headers(requests[0].init.headers).get('Authorization'),
    'Bearer token',
  );
  assert.equal(requests[0].init.cache, 'no-store');
});

test('Phản hồi 401 của API bảo vệ hủy phiên tương ứng kể cả khi body không phải JSON', async () => {
  const { api, invalidated } = setup(
    { ok: false, status: 401 },
    { jsonFails: true },
  );
  await assert.rejects(
    api.getMeApi('old-token'),
    (error) => error.status === 401,
  );
  assert.deepEqual(invalidated, ['old-token']);
});

test('Thông tin đăng nhập sai hiện lỗi và giữ phiên đã có', async () => {
  const { api, invalidated } = setup({
    ok: false,
    status: 401,
    body: { error: { message: 'Sai tài khoản hoặc mật khẩu.' } },
  });
  await assert.rejects(
    api.loginApi({ username: 'wrong', password: 'wrong' }),
    /Sai tài khoản/,
  );
  assert.deepEqual(invalidated, []);
});

test('Lỗi máy chủ hoặc mạng giữ nguyên phiên', async () => {
  for (const response of [
    { ok: false, status: 503, body: {} },
    new Error('network'),
  ]) {
    const { api, invalidated } = setup(response);
    await assert.rejects(api.getMeApi('token'));
    assert.deepEqual(invalidated, []);
  }
});

test('API bảo vệ dùng JWT hiện tại và từ chối phiên thiếu trước khi gọi mạng', async () => {
  const { api, requests } = setup({
    ok: true,
    status: 200,
    body: { data: 'private' },
  });
  assert.equal(await api.authenticatedRequest('/auth/me'), 'private');
  assert.equal(
    new Headers(requests[0].init.headers).get('Authorization'),
    'Bearer current-token',
  );
  const guest = setup({ ok: true }, { token: null });
  await assert.rejects(
    guest.api.authenticatedRequest('/auth/me'),
    (error) => error.status === 401,
  );
  assert.equal(guest.requests.length, 0);
});

test('Đăng ký và đăng nhập trả dữ liệu đã bóc khỏi phản hồi API', async () => {
  const { api } = setup({
    ok: true,
    status: 201,
    body: { data: { accessToken: 'token' } },
  });
  assert.deepEqual(
    await api.registerApi({ username: 'huy', password: 'password' }),
    { accessToken: 'token' },
  );
  assert.deepEqual(
    await api.loginApi({ username: 'huy', password: 'password' }),
    { accessToken: 'token' },
  );
});

test('Đọc được thông báo từ danh sách lỗi validation của NestJS', async () => {
  const { api } = setup({
    ok: false,
    status: 400,
    body: { message: ['Username không hợp lệ', 'Password quá ngắn'] },
  });
  await assert.rejects(
    api.registerApi({ username: '', password: '' }),
    /Username không hợp lệ.*Password quá ngắn/,
  );
});

test('Phản hồi 403 giữ phiên và trả mã FORBIDDEN_RESOURCE', async () => {
  const { api, invalidated } = setup({
    ok: false,
    status: 403,
    body: {
      error: {
        code: 'FORBIDDEN_RESOURCE',
        message: 'Bạn không có quyền truy cập dữ liệu của người dùng khác.',
      },
    },
  });
  await assert.rejects(
    api.authenticatedRequest('/auth/users/other-id'),
    (error) => {
      assert.equal(error.status, 403);
      assert.equal(error.code, 'FORBIDDEN_RESOURCE');
      assert.match(error.message, /không có quyền/);
      return true;
    },
  );
  assert.deepEqual(invalidated, []);
});
