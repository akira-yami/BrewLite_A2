// Kiểm tra API client tải danh mục, báo lỗi và thử lại.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import { createRequire } from 'node:module';

const apiPath = path.resolve(
  process.cwd(),
  'src/features/catalog/api.ts',
);

const source = fs.readFileSync(apiPath, 'utf8');

const compiled = ts.transpileModule(source, {
  compilerOptions: {
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2020,
    esModuleInterop: true,
  },
});

const moduleMock = { exports: {} };

const loadApi = new Function(
  'require',
  'module',
  'exports',
  compiled.outputText,
);

const require = createRequire(import.meta.url);

loadApi(require, moduleMock, moduleMock.exports);

const { fetchMenuProducts } = moduleMock.exports;

test('TC-API-01: Trả về danh sách sản phẩm khi API thành công', async () => {
  const products = [
    {
      id: 'product-1',
      name: 'Cà phê sữa',
    },
    {
      id: 'product-2',
      name: 'Trà đào',
    },
  ];

  let requestedUrl = '';

  const fakeFetch = async (url) => {
    requestedUrl = url;

    return {
      ok: true,
      status: 200,
      json: async () => ({
        data: products,
      }),
    };
  };

  const result = await fetchMenuProducts(fakeFetch);

  assert.equal(
    requestedUrl.endsWith('/products'),
    true,
    'Phải gọi endpoint danh sách sản phẩm',
  );

  assert.deepEqual(result, products);
});

test('TC-API-02: Ném lỗi khi API trả về HTTP 500', async () => {
  const fakeFetch = async () => ({
    ok: false,
    status: 500,
    json: async () => ({}),
  });

  await assert.rejects(
    fetchMenuProducts(fakeFetch),
    /Lỗi kết nối máy chủ \(500\)/,
  );
});

test('TC-API-03: Có thể gọi lại API sau lần thất bại', async () => {
  let requestCount = 0;

  const fakeFetch = async () => {
    requestCount += 1;

    if (requestCount === 1) {
      return {
        ok: false,
        status: 503,
        json: async () => ({}),
      };
    }

    return {
      ok: true,
      status: 200,
      json: async () => ({
        data: [{ id: 'product-1', name: 'Cà phê sữa' }],
      }),
    };
  };

  await assert.rejects(
    fetchMenuProducts(fakeFetch),
    /Lỗi kết nối máy chủ \(503\)/,
  );

  const result = await fetchMenuProducts(fakeFetch);

  assert.equal(requestCount, 2);
  assert.equal(result.length, 1);
  assert.equal(result[0].id, 'product-1');
});
