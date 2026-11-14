// Kiểm tra giao diện menu khi đang tải, rỗng, lỗi và thử lại.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { test } from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import ts from 'typescript';

const require = createRequire(import.meta.url);

// Đọc và biên dịch MenuPage.tsx để chạy test bằng Node.js.
function loadMenuPage(snapshot) {
  const source = readFileSync(
    new URL('../../src/app/menu/page.tsx', import.meta.url),
    'utf8',
  );

  const { outputText } = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      jsx: ts.JsxEmit.ReactJSX,
      esModuleInterop: true,
    },
  });

  // Giả lập các module phụ thuộc của MenuPage.
  const mocks = {
    'next/image': {
      __esModule: true,
      default: ({ alt, src }) => React.createElement('img', { alt, src }),
    },
        'next/navigation': {
      useRouter: () => ({
        push() {},
        replace() {},
        refresh() {},
        back() {},
        prefetch() {},
      }),
      usePathname: () => '/menu',
      useSearchParams: () => new URLSearchParams(),
      useParams: () => ({}),
      redirect() {},
      notFound() {},
    },

    'next/link': {
      __esModule: true,
      default: ({ href, children }) =>
        React.createElement('a', { href }, children),
    },

    '@/features/catalog/hooks/useMenuProducts': {
      useMenuProducts: () => snapshot,
    },

    '@/features/catalog/hooks/useScrollHeader': {
      useScrollHeader: () => true,
    },

    '@/features/catalog/components/HeroBanner': {
      HeroBanner: () => null,
    },

    '@/features/catalog/components/ProductCard': {
      ProductCard: ({ product }) =>
        React.createElement('div', null, product.name),
    },

    '@/features/catalog/components/ProductCardSkeleton': {
      ProductCardSkeleton: () =>
        React.createElement('div', null, 'PRODUCT_SKELETON'),
    },

    '@/features/catalog/components/ProductDetailModal': {
      ProductDetailModal: () => null,
    },

    '@/features/cart/components/CartDrawer': {
      CartDrawer: () => null,
    },

    '@/features/checkout/session': {
      writeCheckoutCoupon() {},
    },

    '@/features/auth/AuthControls': {
      AuthControls: () => null,
    },

    '@/stores/cart-store': {
      cartStore: { addItem() {} },
      formatVnd: (value) => String(value),
      useCartStore: () => ({
        totalQuantity: 0,
        subtotal: 0,
      }),
    },
  };

  const compiledModule = { exports: {} };

  new Function('require', 'module', 'exports', outputText)(
    (name) => {
            if (name === 'react') {
        return {
          ...React,
          useState: (initialValue) => [
            typeof initialValue === 'function' ? initialValue() : initialValue,
            () => {},
          ],
          useMemo: (callback) => callback(),
          useCallback: (callback) => callback,
          useRef: () => ({ current: null }),
          useEffect: () => {},
          useLayoutEffect: () => {},
          useContext: () => undefined,
        };
      }

      // So khớp chính xác tên module, không dùng includes.
      if (Object.prototype.hasOwnProperty.call(mocks, name)) {
        return mocks[name];
      }

      return require(name);
    },
    compiledModule,
    compiledModule.exports,
  );

  const MenuPage = compiledModule.exports.default;

  assert.equal(
    typeof MenuPage,
    'function',
    'MenuPage phải được export dưới dạng default function',
  );

  return MenuPage;
}

// Render trang thành HTML để kiểm tra nội dung hiển thị.
function getMarkup(snapshot) {
  const MenuPage = loadMenuPage(snapshot);

  return renderToStaticMarkup(React.createElement(MenuPage));
}

function makeProduct() {
  return {
    id: 'product-1',
    name: 'Cà phê sữa',
    sku: 'COFFEE-001',
    description: 'Cà phê sữa tươi',
    variants: [],
  };
}

// Tìm nút theo nội dung trong cây React.
function findButtonWithText(element, expectedText) {
  if (!element || typeof element !== 'object') {
    return null;
  }

  if (element.type === 'button') {
    const text = React.Children.toArray(element.props.children)
      .map((child) =>
        typeof child === 'string' || typeof child === 'number'
          ? String(child)
          : '',
      )
      .join('');

    if (text.includes(expectedText)) {
      return element;
    }
  }

  for (const child of React.Children.toArray(element.props?.children)) {
    const found = findButtonWithText(child, expectedText);

    if (found) {
      return found;
    }
  }

  return null;
}

// TC-MENU-01: API đang tải thì hiển thị loading và skeleton.
test('TC-MENU-01: hiển thị loading khi API đang tải', () => {
  const html = getMarkup({
    data: undefined,
    isLoading: true,
    isError: false,
    error: null,
    refetch() {},
  });

  assert.match(html, /Đang tải\.\.\./);
  assert.match(html, /PRODUCT_SKELETON/);
  assert.doesNotMatch(html, /Không thể kết nối đến máy chủ/);
});

// TC-MENU-02: API thành công nhưng không có sản phẩm.
test('TC-MENU-02: hiển thị empty state khi danh sách rỗng', () => {
  const html = getMarkup({
    data: [],
    isLoading: false,
    isError: false,
    error: null,
    refetch() {},
  });

  assert.match(html, /Không tìm thấy món nào/);
  assert.doesNotMatch(html, /Không thể kết nối đến máy chủ/);
});

// TC-MENU-03: API lỗi thì hiển thị thông báo lỗi, không hiển thị empty state.
test('TC-MENU-03: phân biệt lỗi API với danh sách rỗng', () => {
  const html = getMarkup({
    data: undefined,
    isLoading: false,
    isError: true,
    error: new Error('Lỗi kết nối kiểm thử'),
    refetch() {},
  });

  assert.match(html, /Không thể kết nối đến máy chủ/);
  assert.match(html, /Lỗi kết nối kiểm thử/);
  assert.doesNotMatch(html, /Không tìm thấy món nào/);
});

// TC-MENU-04: nút Thử lại gọi hàm refetch.
test('TC-MENU-04: nhấn Thử lại sẽ gọi refetch', () => {
  let retryCount = 0;

  const snapshot = {
    data: undefined,
    isLoading: false,
    isError: true,
    error: new Error('Lỗi kết nối kiểm thử'),
    refetch() {
      retryCount++;
    },
  };

  const MenuPage = loadMenuPage(snapshot);
  const tree = MenuPage();
  const retryButton = findButtonWithText(tree, 'Thử lại');

  assert.ok(retryButton, 'Phải tìm thấy nút Thử lại');
  assert.equal(typeof retryButton.props.onClick, 'function');

  retryButton.props.onClick();

  assert.equal(retryCount, 1);
});

// TC-MENU-05: API thành công và có sản phẩm.
test('TC-MENU-05: hiển thị sản phẩm khi API trả dữ liệu thành công', () => {
  const html = getMarkup({
    data: [makeProduct()],
    isLoading: false,
    isError: false,
    error: null,
    refetch() {},
  });

  assert.match(html, /Cà phê sữa/);
  assert.doesNotMatch(html, /Không tìm thấy món nào/);
  assert.doesNotMatch(html, /Không thể kết nối đến máy chủ/);
});