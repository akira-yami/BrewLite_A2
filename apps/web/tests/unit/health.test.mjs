// Kiểm tra route báo Web đang chạy.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { GET } from '../../src/app/health/route.ts';

test('Route health trả trạng thái Web đang chạy mà không cần đăng nhập', async () => {
  const response = GET();
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { status: 'ok' });
});
