'use client';

import { useEffect, useState, useSyncExternalStore } from 'react';

function subscribeToConnection(notify: () => void) {
  window.addEventListener('online', notify);
  window.addEventListener('offline', notify);
  return () => {
    window.removeEventListener('online', notify);
    window.removeEventListener('offline', notify);
  };
}

export function OfflineBanner() {
  const isOnline = useSyncExternalStore(subscribeToConnection, () => navigator.onLine, () => true);
  const [showReconnected, setShowReconnected] = useState(false);

  useEffect(() => {
    // Đăng ký Service Worker cho PWA
    if ('serviceWorker' in navigator && process.env.NODE_ENV === 'production') {
      navigator.serviceWorker
        .register('/sw.js')
        .catch((err) => console.warn('[PWA] ServiceWorker registration failed:', err));
    }

    let timer: ReturnType<typeof setTimeout> | undefined;

    function handleOnline() {
      clearTimeout(timer);
      setShowReconnected(true);
      timer = setTimeout(() => {
        setShowReconnected(false);
      }, 4000);
    }

    function handleOffline() {
      clearTimeout(timer);
      setShowReconnected(false);
    }

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    return () => {
      clearTimeout(timer);
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  function handleRetry() {
    if (navigator.onLine) window.location.reload();
  }

  if (isOnline && !showReconnected) {
    return null;
  }

  if (showReconnected) {
    return (
      <aside
        role="status"
        aria-live="polite"
        className="sticky top-0 z-50 flex items-center justify-between border-b border-emerald-300 bg-emerald-50 px-4 py-2.5 text-xs sm:text-sm font-medium text-emerald-900 shadow-sm transition-all duration-300"
      >
        <div className="flex items-center gap-2">
          <span className="flex h-2.5 w-2.5 rounded-full bg-emerald-600 animate-pulse" />
          <span>Đã khôi phục kết nối mạng. Bạn có thể tiếp tục đặt món.</span>
        </div>
        <button
          type="button"
          onClick={() => setShowReconnected(false)}
          className="rounded px-2 py-0.5 text-xs text-emerald-800 hover:bg-emerald-100"
        >
          Đóng
        </button>
      </aside>
    );
  }

  return (
    <aside
      role="alert"
      aria-live="assertive"
      className="sticky top-0 z-50 flex flex-wrap items-center justify-between gap-2 border-b border-amber-300 bg-amber-50 px-4 py-2.5 text-xs sm:text-sm font-medium text-amber-900 shadow-sm"
    >
      <div className="flex items-center gap-2">
        <span className="flex h-2.5 w-2.5 rounded-full bg-amber-600" />
        <span>
          Mất kết nối mạng. Bạn đang ở chế độ ngoại tuyến. Giỏ hàng vẫn được lưu cục bộ; thanh toán trực tuyến cần có kết nối mạng.
        </span>
      </div>
      <button
        type="button"
        onClick={handleRetry}
        className="rounded bg-amber-200 px-3 py-1 text-xs font-semibold text-amber-950 transition hover:bg-amber-300 active:scale-95"
      >
        Thử lại
      </button>
    </aside>
  );
}
