'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useRef, useState } from 'react';
import { createOrderApi, OrdersApiError } from '@/features/orders/api';
import { CheckoutAPI, CheckoutApiError } from '@/services/checkout.api';
import type { PaymentMethod, ValidateCouponResponse } from '@/types/checkout.contract';
import { cartStore, formatVnd, useCartStore } from '@/stores/cart-store';
import { authSession } from '@/features/auth/session';

const paymentOptions: Array<{ method: PaymentMethod; title: string; description: string; icon: string }> = [
  { method: 'E_WALLET', title: 'Ví điện tử', description: 'Thanh toán nhanh qua ví BrewLite', icon: '◉' },
  { method: 'CARD', title: 'Thẻ ngân hàng', description: 'Thẻ nội địa hoặc quốc tế', icon: '▣' },
];

function newIdempotencyKey() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }

  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function paymentFailureMessage(failureCode?: string | null, message?: string) {
  if (failureCode === 'INSUFFICIENT_FUNDS') {
    return 'Số dư hoặc hạn mức thanh toán không đủ. Giỏ hàng của bạn vẫn được giữ nguyên.';
  }

  return message ?? failureCode ?? 'Thanh toán chưa thành công. Giỏ hàng của bạn vẫn được giữ nguyên để thử lại.';
}

export default function CheckoutPage() {
  const router = useRouter();
  const cart = useCartStore();
  const [method, setMethod] = useState<PaymentMethod>('E_WALLET');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [couponCode, setCouponCode] = useState('');
  const [coupon, setCoupon] = useState<ValidateCouponResponse | null>(null);
  const [couponLoading, setCouponLoading] = useState(false);
  const [couponError, setCouponError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const createdOrderId = useRef<string | null>(null);
  const paymentAttemptKey = useRef<string | null>(null);
  const [hasCreatedOrder, setHasCreatedOrder] = useState(false);
  const payableTotal = Math.max(0, cart.subtotal - (coupon?.discountAmount ?? 0));

  const handleCoupon = async () => {
    const code = couponCode.trim();
    const token = authSession.getToken();
    if (!code) {
      setCouponError('Nhập mã giảm giá trước khi áp dụng.');
      return;
    }
    if (!token) {
      setCouponError('Vui lòng đăng nhập để sử dụng mã giảm giá.');
      return;
    }

    setCouponLoading(true);
    setCouponError(null);
    try {
      setCoupon(await CheckoutAPI.validateCoupon(token, { code, subtotal: cart.subtotal }));
    } catch (reason) {
      setCoupon(null);
      setCouponError(
        reason instanceof CheckoutApiError
          ? reason.message
          : 'Không thể kiểm tra mã giảm giá. Vui lòng thử lại.',
      );
    } finally {
      setCouponLoading(false);
    }
  };

  const removeCoupon = () => {
    setCoupon(null);
    setCouponCode('');
    setCouponError(null);
  };

  const handlePayment = async () => {
    if (cart.items.length === 0) return;

    const token = authSession.getToken();
    if (!token) {
      setError('Vui lòng đăng nhập trước khi đặt hàng.');
      return;
    }

    setIsSubmitting(true);
    setError(null);

    try {
      let orderId = createdOrderId.current;
      if (!orderId) {
        const order = await createOrderApi(token, {
          items: cartStore.getOrderItems(),
          couponCode: coupon?.code,
        });
        orderId = order.id;
        createdOrderId.current = order.id;
        setHasCreatedOrder(true);
      }

      const idempotencyKey = paymentAttemptKey.current ?? newIdempotencyKey();
      paymentAttemptKey.current = idempotencyKey;
      const payment = await CheckoutAPI.processPayment(token, { orderId, method }, idempotencyKey);

      // Chỉ failure đã xác nhận mới cấp key mới. Lỗi mạng giữ key để replay,
      // tránh một click thử lại trở thành một giao dịch thanh toán khác.
      if (payment.status !== 'SUCCEEDED') {
        paymentAttemptKey.current = null;
        setError(paymentFailureMessage(payment.failureCode, payment.errorCode ? String(payment.errorCode) : undefined));
        return;
      }

      cartStore.clearCart();
      // Payment response không trả orderId; dùng ID đã được server tạo ở bước trên.
      router.replace(`/orders/confirmation?orderId=${encodeURIComponent(orderId)}`);
    } catch (reason) {
      if (reason instanceof OrdersApiError) {
        if (reason.status === 401) {
          setError('Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.');
        } else if (reason.status === 409) {
          setError('Một số món vừa hết hàng hoặc không còn khả dụng. Giỏ hàng vẫn được giữ nguyên.');
        } else {
          setError(reason.message);
        }
      } else if (reason instanceof CheckoutApiError) {
        if (reason.code === 'PAYMENT_IN_PROGRESS') {
          setError('Giao dịch đang được xử lý. Vui lòng chờ rồi thử lại với cùng phương thức.');
        } else if (reason.code === 'ORDER_EXPIRED') {
          // Bắt đúng mã lỗi ORDER_EXPIRED từ server trả về
          setError('Đơn hàng đã hết hạn thanh toán do quá thời gian giữ chỗ. Vui lòng đặt lại đơn mới.');

          // QUAN TRỌNG: Reset ID để tạo đơn hàng mới cho lần bấm thanh toán tiếp theo
          createdOrderId.current = null;
          paymentAttemptKey.current = null;
          setHasCreatedOrder(false);

        } else if (reason.status === 401) {
          setError('Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.');
        } else {
          setError(`${reason.message} Giỏ hàng của bạn vẫn được giữ nguyên.`);
        }
      } else {
        setError('Không thể kết nối đến máy chủ thanh toán. Giỏ hàng của bạn vẫn được giữ nguyên.');
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  if (cart.items.length === 0) {
    return (
      <main className="min-h-screen bg-[#FBF8F3] px-4 py-16 text-[#1A1612]">
        <section className="mx-auto max-w-lg rounded-3xl border border-[#E5DCD2] bg-white p-8 text-center shadow-sm">
          <p className="text-xs font-black uppercase tracking-[0.2em] text-[#B85D36]">BrewLite checkout</p>
          <h1 className="mt-3 text-3xl font-black text-[#163E2B]">Giỏ hàng đang trống</h1>
          <p className="mt-3 text-sm leading-6 text-[#756A63]">Hãy chọn món trước khi tiếp tục đến bước thanh toán.</p>
          <Link href="/menu" className="mt-6 inline-flex rounded-full bg-[#163E2B] px-5 py-3 text-sm font-black text-white">
            Xem thực đơn
          </Link>
        </section>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-[#FBF8F3] px-4 py-8 text-[#1A1612] sm:py-12">
      <section className="mx-auto grid max-w-5xl gap-6 lg:grid-cols-[1.1fr_.9fr]">
        <div className="rounded-3xl border border-[#E5DCD2] bg-white p-5 shadow-sm sm:p-8">
          <Link href="/menu" className="text-sm font-bold text-[#163E2B] hover:underline">← Quay lại giỏ hàng</Link>
          <p className="mt-6 text-xs font-black uppercase tracking-[0.2em] text-[#B85D36]">BrewLite checkout</p>
          <h1 className="mt-2 text-3xl font-black text-[#163E2B] sm:text-4xl">Chọn phương thức thanh toán</h1>
          <p className="mt-2 text-sm leading-6 text-[#756A63]">Đơn hàng sẽ được tạo trước, sau đó thanh toán qua phương thức bạn chọn.</p>

          <div className="mt-6 space-y-3">
            {paymentOptions.map((option) => {
              const selected = method === option.method;
              return (
                <button
                  key={option.method}
                  type="button"
                  onClick={() => {
                    if (option.method !== method) paymentAttemptKey.current = null;
                    setMethod(option.method);
                  }}
                  className={`flex w-full items-center gap-4 rounded-2xl border p-4 text-left transition ${
                    selected ? 'border-[#163E2B] bg-[#E8F1EC]' : 'border-[#E5DCD2] bg-[#FCFAF7] hover:border-[#9fb9ab]'
                  }`}
                  aria-pressed={selected}
                >
                  <span className={`flex h-11 w-11 items-center justify-center rounded-full text-xl ${selected ? 'bg-[#163E2B] text-white' : 'bg-white text-[#163E2B]'}`} aria-hidden="true">{option.icon}</span>
                  <span className="flex-1">
                    <span className="block text-sm font-black text-[#1E1813]">{option.title}</span>
                    <span className="mt-1 block text-xs text-[#756A63]">{option.description}</span>
                  </span>
                  <span className={`h-5 w-5 rounded-full border-2 ${selected ? 'border-[#163E2B] bg-[#163E2B] shadow-[inset_0_0_0_3px_#E8F1EC]' : 'border-[#B9AEA4]'}`} />
                </button>
              );
            })}
          </div>

          <section className="mt-8 border-t border-[#EDE6DD] pt-6" aria-labelledby="coupon-title">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h2 id="coupon-title" className="text-base font-black text-[#163E2B]">Mã giảm giá</h2>
                <p className="mt-1 text-xs text-[#756A63]">Mã được máy chủ kiểm tra lại khi tạo đơn.</p>
              </div>
              {coupon && (
                <button type="button" onClick={removeCoupon} disabled={hasCreatedOrder} className="text-xs font-bold text-[#9f3f2f] hover:underline disabled:cursor-not-allowed disabled:opacity-50">
                  Gỡ mã
                </button>
              )}
            </div>
            <div className="mt-3 flex gap-2">
              <input
                value={couponCode}
                onChange={(event) => {
                  setCouponCode(event.target.value);
                  if (coupon && event.target.value.trim() !== coupon.code) setCoupon(null);
                  setCouponError(null);
                }}
                disabled={hasCreatedOrder || couponLoading}
                placeholder="Nhập mã giảm giá"
                className="min-w-0 flex-1 rounded-xl border border-[#D8CCBA] bg-white px-3 py-2.5 text-sm uppercase outline-none placeholder:normal-case focus:border-[#163E2B] disabled:bg-[#F5F1EB]"
                aria-label="Mã giảm giá"
              />
              <button type="button" onClick={handleCoupon} disabled={hasCreatedOrder || couponLoading || Boolean(coupon)} className="rounded-xl bg-[#E8F1EC] px-4 py-2 text-sm font-black text-[#163E2B] transition hover:bg-[#dcebe3] disabled:cursor-not-allowed disabled:opacity-50">
                {couponLoading ? 'Đang kiểm tra...' : 'Áp dụng'}
              </button>
            </div>
            {coupon && <p className="mt-2 text-xs font-semibold text-emerald-700">Đã áp dụng {coupon.code}: giảm {formatVnd(coupon.discountAmount)}.</p>}
            {couponError && <p role="alert" className="mt-2 text-xs font-semibold text-rose-700">{couponError}</p>}
          </section>

          {error && (
            <div role="alert" className="mt-5 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm leading-6 text-rose-800">
              {error}
            </div>
          )}

          <button
            type="button"
            onClick={handlePayment}
            disabled={isSubmitting}
            className="mt-6 w-full rounded-full bg-[#163E2B] px-5 py-3.5 text-sm font-black text-white shadow-md transition hover:bg-[#1f4f38] disabled:cursor-not-allowed disabled:opacity-60"
          >
            {isSubmitting ? 'Đang tạo đơn và thanh toán...' : `Thanh toán ${formatVnd(payableTotal)}`}
          </button>
          <p className="mt-3 text-center text-xs leading-5 text-[#756A63]">Tổng tiền cuối cùng được máy chủ xác nhận theo giá và tồn kho hiện tại.</p>
        </div>

        <aside className="h-fit rounded-3xl border border-[#E5DCD2] bg-white p-5 shadow-sm sm:p-6">
          <h2 className="text-lg font-black text-[#163E2B]">Tóm tắt đơn hàng</h2>
          <div className="mt-4 space-y-3 border-b border-[#EDE6DD] pb-4">
            {cart.items.map((item) => (
              <div key={item.id} className="flex items-start justify-between gap-4 text-sm">
                <div>
                  <p className="font-bold text-[#1E1813]">{item.name} <span className="text-[#756A63]">× {item.quantity}</span></p>
                  <p className="mt-1 text-xs text-[#756A63]">Size {item.size}{item.toppings.length ? ` · ${item.toppings.map((topping) => topping.name).join(', ')}` : ''}</p>
                </div>
                <strong className="shrink-0 font-mono text-[#163E2B]">{formatVnd(item.lineTotal)}</strong>
              </div>
            ))}
          </div>
          <div className="mt-4 flex items-center justify-between text-sm">
            <span className="text-[#756A63]">Tạm tính ({cart.totalQuantity} món)</span>
            <strong className="font-mono text-lg text-[#163E2B]">{formatVnd(cart.subtotal)}</strong>
          </div>
          <div className="mt-3 flex items-center justify-between text-sm">
            <span className="text-[#756A63]">Giảm giá{coupon ? ` (${coupon.code})` : ''}</span>
            <strong className="font-mono text-emerald-700">-{formatVnd(coupon?.discountAmount ?? 0)}</strong>
          </div>
          <div className="mt-3 flex items-center justify-between border-t border-[#EDE6DD] pt-4 text-base">
            <span className="font-black text-[#163E2B]">Tổng thanh toán</span>
            <strong className="font-mono text-xl text-[#163E2B]">{formatVnd(payableTotal)}</strong>
          </div>
        </aside>
      </section>
    </main>
  );
}
