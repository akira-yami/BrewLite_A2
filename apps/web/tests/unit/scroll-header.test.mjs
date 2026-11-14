// Kiểm tra header hiện/ẩn khi cuộn và giữ hiển thị khi điều hướng bằng bàn phím.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import ts from 'typescript';

function mountHeader() {
  let visible = true;
  let cleanup;
  let focused = false;
  let keyboardFocus = false;
  let nextFrame = 0;
  const frames = new Map();
  const listeners = new Map();
  const browser = {
    scrollY: 0,
    addEventListener: (event, callback) => listeners.set(event, callback),
    removeEventListener: (event, callback) => {
      if (listeners.get(event) === callback) listeners.delete(event);
    },
    requestAnimationFrame: (callback) => {
      frames.set(++nextFrame, callback);
      return nextFrame;
    },
    cancelAnimationFrame: (id) => frames.delete(id),
  };
  const react = {
    useState: () => [visible, (value) => { visible = value; }],
    useEffect: (effect) => { cleanup = effect(); },
  };
  const source = readFileSync(new URL('../../src/features/catalog/hooks/useScrollHeader.ts', import.meta.url), 'utf8');
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS },
  });
  const hookModule = { exports: {} };
  new Function('require', 'module', 'exports', 'window', 'document', outputText)(
    () => react, hookModule, hookModule.exports, browser,
    { activeElement: { matches: () => keyboardFocus } },
  );
  hookModule.exports.useScrollHeader({ current: { contains: () => focused } });

  return {
    get visible() { return visible; },
    get listenerCount() { return listeners.size; },
    get frameCount() { return frames.size; },
    focusHeader(keyboard = true) { focused = true; keyboardFocus = keyboard; },
    scroll(y, flush = true) {
      browser.scrollY = y;
      listeners.get('scroll')?.();
      if (flush) {
        for (const [id, callback] of frames) {
          frames.delete(id);
          callback();
        }
      }
    },
    unmount() { cleanup(); },
  };
}

test('header remains visible near the top, hides scrolling down and returns scrolling up', () => {
  const header = mountHeader();
  header.scroll(50);
  assert.equal(header.visible, true);
  header.scroll(150);
  assert.equal(header.visible, false);
  header.scroll(130);
  assert.equal(header.visible, true);
  header.scroll(250);
  assert.equal(header.visible, false);
  header.scroll(0);
  assert.equal(header.visible, true);
  header.scroll(-20);
  assert.equal(header.visible, true);
});

test('small direction changes do not make the header flicker', () => {
  const header = mountHeader();
  header.scroll(200);
  for (const position of [197, 199, 195, 198]) header.scroll(position);
  assert.equal(header.visible, false);
  header.scroll(185);
  assert.equal(header.visible, true);
});

test('header stays visible while a navigation control has keyboard focus', () => {
  const header = mountHeader();
  header.focusHeader();
  header.scroll(250);
  assert.equal(header.visible, true);
});

test('clicking a navigation control does not prevent hiding on subsequent scrolls', () => {
  const header = mountHeader();
  header.focusHeader(false);
  header.scroll(250);
  assert.equal(header.visible, false);
});

test('rapid scrolling shares a frame and unmount removes the listener and pending frame', () => {
  const header = mountHeader();
  header.scroll(150, false);
  header.scroll(250, false);
  assert.equal(header.frameCount, 1);
  header.unmount();
  assert.equal(header.listenerCount, 0);
  assert.equal(header.frameCount, 0);
});
