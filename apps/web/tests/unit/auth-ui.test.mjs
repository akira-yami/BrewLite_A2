// Kiểm tra giao diện và thao tác đăng nhập, đăng ký, đăng xuất.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { test } from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import ts from 'typescript';

const require = createRequire(import.meta.url);
function load(file, mocks) {
  const { outputText } = ts.transpileModule(
    readFileSync(new URL(file, import.meta.url), 'utf8'),
    {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
        jsx: ts.JsxEmit.ReactJSX,
      },
    },
  );
  const compiledModule = { exports: {} };
  new Function('require', 'module', 'exports', outputText)(
    (name) => {
      const match = Object.keys(mocks).find((key) =>
        key === 'react' ? name === key : name.includes(key),
      );
      if (match) return mocks[match];
      if (name === 'next/link')
        return {
          default: ({ href, children }) =>
            React.createElement('a', { href }, children),
        };
      return require(name);
    },
    compiledModule,
    compiledModule.exports,
  );
  return compiledModule.exports;
}
function find(element, type) {
  if (!element || typeof element !== 'object') return null;
  if (element.type === type) return element;
  for (const child of React.Children.toArray(element.props?.children)) {
    const match = find(child, type);
    if (match) return match;
  }
  return null;
}

test('Menu shows a login link for guests and an escaped username/logout for customers', () => {
  let snapshot = { status: 'anonymous', user: null };
  let logouts = 0;
  const ui = load('../../src/features/auth/AuthControls.tsx', {
    'use-auth-session': { useAuthSession: () => snapshot },
    './session': { authSession: { logout: () => logouts++ } },
    './api': {},
  });
  assert.match(
    renderToStaticMarkup(React.createElement(ui.AuthControls)),
    /href="\/login"/,
  );
  snapshot = {
    status: 'authenticated',
    user: { username: '<script>huy</script>' },
  };
  const element = ui.AuthControls();
  const html = renderToStaticMarkup(element);
  assert.match(html, /Đăng xuất/);
  assert.match(html, /&lt;script&gt;huy&lt;\/script&gt;/);
  find(element, 'button').props.onClick();
  assert.equal(logouts, 1);
});

test('Menu exposes session loading and a recovery action for network errors', () => {
  let snapshot = { status: 'loading' };
  let retries = 0;
  const ui = load('../../src/features/auth/AuthControls.tsx', {
    'use-auth-session': { useAuthSession: () => snapshot },
    './session': { authSession: { restore: async () => retries++ } },
    './api': {},
  });
  assert.match(
    renderToStaticMarkup(React.createElement(ui.AuthControls)),
    /Đang kiểm tra phiên/,
  );
  snapshot = { status: 'error' };
  find(ui.AuthControls(), 'button').props.onClick();
  assert.equal(retries, 1);
});

test('customer AuthControls displays a Loyalty badge linking to the rewards page', () => {
  const ui = load('../../src/features/auth/AuthControls.tsx', {
    'use-auth-session': { useAuthSession: () => ({ status: 'authenticated', user: { id: 'u1', username: 'huy', role: 'CUSTOMER', loyaltyBalance: 12500 } }) },
    './session': { authSession: { logout() {} } },
    './api': {},
  });
  const html = renderToStaticMarkup(React.createElement(ui.AuthControls));
  assert.match(html, /href="\/loyalty"/);
  assert.match(html, /12\.500 điểm/);
});

test('Login explains automatic expiry and intentional logout', () => {
  let snapshot = { reason: 'expired' };
  const ui = load('../../src/features/auth/AuthControls.tsx', {
    'use-auth-session': { useAuthSession: () => snapshot },
    './session': {},
    './api': {},
  });
  assert.match(
    renderToStaticMarkup(React.createElement(ui.SessionNotice)),
    /đăng nhập lại/,
  );
  snapshot = { reason: 'unauthorized' };
  assert.match(
    renderToStaticMarkup(React.createElement(ui.SessionNotice)),
    /đăng nhập lại/,
  );
  snapshot = { reason: 'logout' };
  assert.match(
    renderToStaticMarkup(React.createElement(ui.SessionNotice)),
    /đã đăng xuất/,
  );
  snapshot = { reason: null };
  assert.equal(renderToStaticMarkup(React.createElement(ui.SessionNotice)), '');
});

for (const page of ['login', 'register']) {
  test(`${page} establishes the shared session and navigates after success`, async () => {
    const states =
      page === 'login'
        ? ['huy', 'Password123!', false, null]
        : ['huy', 'Password123!', 'Password123!', false, null];
    const saved = [],
      navigations = [];
    const response = {
      accessToken: 'test-token',
      user: { username: 'huy' },
      expiresIn: 900,
    };
    let stateIndex = 0;
    const component = load(`../../src/app/${page}/page.tsx`, {
      'next/navigation': {
        useRouter: () => ({ replace: (path) => navigations.push(path) }),
      },
      'features/auth/api': {
        loginApi: async () => response,
        registerApi: async () => response,
      },
      'features/auth/session': {
        authSession: { establish: (data) => saved.push(data) },
      },
      'features/auth/AuthControls': { SessionNotice: () => null },
      react: { ...React, useState: () => [states[stateIndex++], () => {}] },
    });
    const form = find(component.default(), 'form');
    await form.props.onSubmit({ preventDefault() {} });
    assert.deepEqual(saved, [response]);
    assert.deepEqual(navigations, ['/menu']);
  });
}
