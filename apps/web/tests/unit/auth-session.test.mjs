// Kiểm tra lưu, khôi phục, hết hạn và đổi phiên đăng nhập.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createAuthSession } from '../../src/features/auth/session.ts';

const now = 1800000000000;
const user = {
  id: 'customer',
  username: 'huy',
  role: 'CUSTOMER',
  loyaltyBalance: 0,
  isActive: true,
  createdAt: '2026-10-19T00:00:00Z',
};
const jwt = (expiresAt = now + 900000, extra = {}) =>
  `e30.${Buffer.from(JSON.stringify({ exp: expiresAt / 1000, ...extra })).toString('base64url')}.signature`;

function setup(initial = {}) {
  let clock = now;
  let nextId = 0;
  const values = new Map(Object.entries(initial));
  const timers = new Map();
  const store = createAuthSession({
    storage: () => ({
      getItem: (key) => values.get(key) ?? null,
      setItem: (key, value) => values.set(key, value),
      removeItem: (key) => values.delete(key),
    }),
    now: () => clock,
    schedule: (callback, delay) => {
      timers.set(++nextId, { callback, at: clock + delay });
      return nextId;
    },
    cancel: (id) => timers.delete(id),
  });
  return {
    store,
    values,
    timers,
    advance(ms) {
      clock += ms;
      for (const [id, timer] of [...timers])
        if (timer.at <= clock) {
          timers.delete(id);
          timer.callback();
        }
    },
  };
}

test('login persists a session and notifies subscribers without touching the cart', () => {
  const { store, values } = setup({ brewlite_cart_storage: '["cart"]' });
  let updates = 0;
  const unsubscribe = store.subscribe(() => updates++);
  store.establish({ accessToken: jwt(), user, expiresIn: 900 });
  assert.equal(store.getSnapshot().status, 'authenticated');
  assert.equal(store.getSnapshot().user.username, 'huy');
  assert.equal(values.get('brewlite_token'), jwt());
  assert.equal(values.get('brewlite_cart_storage'), '["cart"]');
  assert.ok(updates > 0);
  unsubscribe();
});

test('reload verifies the stored token with the server instead of trusting cached user data', async () => {
  const token = jwt();
  const { store } = setup({
    brewlite_token: token,
    brewlite_user: '{"role":"BARISTA"}',
  });
  await store.restore(async (received) => {
    assert.equal(received, token);
    return user;
  });
  assert.equal(store.getSnapshot().status, 'authenticated');
  assert.equal(store.getSnapshot().user.role, 'CUSTOMER');
});

test('logout removes auth data, cancels expiry and preserves the cart', () => {
  const { store, values, timers } = setup({
    brewlite_cart_storage: '["cart"]',
  });
  store.establish({ accessToken: jwt(), user, expiresIn: 900 });
  store.logout();
  assert.equal(store.getSnapshot().reason, 'logout');
  assert.equal(store.getSnapshot().token, null);
  assert.equal(values.has('brewlite_token'), false);
  assert.equal(values.has('brewlite_user'), false);
  assert.equal(values.get('brewlite_cart_storage'), '["cart"]');
  assert.equal(timers.size, 0);
});

test('expiry clears a session automatically without making another HTTP request', () => {
  const { store, advance } = setup();
  store.establish({ accessToken: jwt(now + 1000), user, expiresIn: 900 });
  advance(1000);
  assert.equal(store.getSnapshot().status, 'anonymous');
  assert.equal(store.getSnapshot().reason, 'expired');
});

for (const token of [jwt(now - 1000), 'malformed', 'e30.e30.signature']) {
  test(`invalid/expired persisted JWT is removed before profile fetch: ${token.slice(0, 18)}`, async () => {
    const { store, values } = setup({ brewlite_token: token });
    let calls = 0;
    await store.restore(async () => {
      calls++;
      return user;
    });
    assert.equal(calls, 0);
    assert.equal(store.getSnapshot().reason, 'expired');
    assert.equal(values.has('brewlite_token'), false);
  });
}

test('a 401 restoring the session clears credentials', async () => {
  const { store, values } = setup({ brewlite_token: jwt() });
  await store.restore(async () => {
    throw Object.assign(new Error('unauthorized'), { status: 401 });
  });
  assert.equal(store.getSnapshot().reason, 'unauthorized');
  assert.equal(values.has('brewlite_token'), false);
});

test('network or server failure preserves credentials and allows retry', async () => {
  const { store, values } = setup({ brewlite_token: jwt() });
  await store.restore(async () => {
    throw new Error('offline');
  });
  assert.equal(store.getSnapshot().status, 'error');
  assert.equal(values.get('brewlite_token'), jwt());
  await store.restore(async () => user);
  assert.equal(store.getSnapshot().status, 'authenticated');
});

test('a delayed profile response cannot resurrect a logged-out session', async () => {
  const { store } = setup({ brewlite_token: jwt() });
  let finish;
  const pending = store.restore(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  store.logout();
  finish(user);
  await pending;
  assert.equal(store.getSnapshot().status, 'anonymous');
});

test('a stale 401 cannot log out a newer login', () => {
  const { store } = setup();
  const oldToken = jwt(now + 10000);
  const newToken = jwt(now + 20000);
  store.establish({ accessToken: oldToken, user, expiresIn: 900 });
  store.establish({ accessToken: newToken, user, expiresIn: 900 });
  store.invalidate(oldToken);
  assert.equal(store.getSnapshot().token, newToken);
});

test('a profile response cannot overwrite a newer login', async () => {
  const { store } = setup({ brewlite_token: jwt() });
  let finish;
  const pending = store.restore(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  store.establish({
    accessToken: jwt(now + 20000),
    user: { ...user, username: 'new-login' },
    expiresIn: 900,
  });
  finish(user);
  await pending;
  assert.equal(store.getSnapshot().user.username, 'new-login');
});

test('logout in another tab is reflected when storage is reloaded', async () => {
  const { store, values } = setup();
  store.establish({ accessToken: jwt(), user, expiresIn: 900 });
  values.delete('brewlite_token');
  await store.restore(async () => {
    throw new Error('must not fetch');
  });
  assert.equal(store.getSnapshot().reason, 'logout');
});

test('storage unavailable does not crash login or logout', () => {
  const store = createAuthSession({
    storage: () => {
      throw new Error('storage blocked');
    },
  });
  assert.doesNotThrow(() =>
    store.establish({
      accessToken: jwt(Date.now() + 60000),
      user,
      expiresIn: 60,
    }),
  );
  assert.equal(store.getSnapshot().status, 'authenticated');
  assert.doesNotThrow(() => store.logout());
});

test('server render and missing session stay anonymous without browser globals', async () => {
  const store = createAuthSession({ storage: () => null });
  assert.equal(store.getServerSnapshot().user, null);
  assert.equal(store.getServerSnapshot(), store.getServerSnapshot());
  await store.restore(async () => {
    throw new Error('must not fetch');
  });
  assert.equal(store.getSnapshot().status, 'anonymous');
});

test('inactive users are not restored as authenticated', async () => {
  const { store } = setup({ brewlite_token: jwt() });
  await store.restore(async () => ({ ...user, isActive: false }));
  assert.equal(store.getSnapshot().reason, 'unauthorized');
});

test('invalid login responses are rejected without saving credentials', () => {
  const { store, values } = setup();
  for (const auth of [
    { accessToken: 'bad', user, expiresIn: 900 },
    { accessToken: jwt(), user, expiresIn: 0 },
    { accessToken: jwt(), user: { ...user, isActive: false }, expiresIn: 900 },
  ])
    assert.throws(() => store.establish(auth), /không hợp lệ/);
  assert.equal(values.has('brewlite_token'), false);
});

test('reading the token rechecks expiry even if a background timer was delayed', () => {
  const { store, advance, timers } = setup();
  store.establish({ accessToken: jwt(now + 1000), user, expiresIn: 900 });
  assert.equal(store.getToken(), jwt(now + 1000));
  timers.clear();
  advance(1001);
  assert.equal(store.getToken(), null);
  assert.equal(store.getSnapshot().reason, 'expired');
});

test('provider cleanup cancels timers and ignores pending profile responses', async () => {
  const { store, timers } = setup({ brewlite_token: jwt() });
  let finish;
  const pending = store.restore(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  store.stop();
  finish(user);
  await pending;
  assert.equal(timers.size, 0);
  assert.notEqual(store.getSnapshot().status, 'authenticated');
});

test('native browser timers are called without an incompatible receiver', () => {
  const originalSchedule = globalThis.setTimeout;
  const originalCancel = globalThis.clearTimeout;
  globalThis.setTimeout = function (callback, delay) {
    assert.ok(
      this === undefined || this === globalThis,
      'illegal Window.setTimeout receiver',
    );
    return originalSchedule(callback, delay);
  };
  globalThis.clearTimeout = function (timer) {
    assert.ok(
      this === undefined || this === globalThis,
      'illegal Window.clearTimeout receiver',
    );
    return originalCancel(timer);
  };
  const store = createAuthSession({ storage: () => null });
  try {
    store.establish({
      accessToken: jwt(Date.now() + 60000),
      user,
      expiresIn: 60,
    });
    store.logout();
  } finally {
    globalThis.setTimeout = originalSchedule;
    globalThis.clearTimeout = originalCancel;
    store.stop();
  }
});
