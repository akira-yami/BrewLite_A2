'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useOrderPaymentRetry } from '@/features/checkout/use-order-payment-retry';
import { PaymentApiError } from '@/features/payments/api';
import type { OrderSummary } from '../types';

function isUnpaid(order: OrderSummary) {
  return order.status === 'PENDING' || order.status === 'PAYMENT_FAILED';
}

export function isUnpaidExpired(order: OrderSummary) {
  return isUnpaid(order) && Boolean(
    order.reservationExpiresAt && Date.parse(order.reservationExpiresAt) <= Date.now(),
  );
}

export function OrderPaymentRetry({ order, token }: { order: OrderSummary; token: string }) {
  const client = useQueryClient();
  const retryOrderPayment = useOrderPaymentRetry();
  const payment = useMutation({
    mutationFn: () => retryOrderPayment(token, order.id),
    onError: async (error) => {
      if (error instanceof PaymentApiError && error.code === 'ORDER_EXPIRED') {
        await Promise.all([
          client.invalidateQueries({ queryKey: ['orders-history'] }),
          client.invalidateQueries({ queryKey: ['order-detail', token, order.id] }),
        ]);
      }
    },
  });

  if (!isUnpaid(order) || isUnpaidExpired(order)) return null;
  const errorMessage = payment.error instanceof PaymentApiError && payment.error.code === 'ORDER_EXPIRED'
    ? 'Đơn hàng đã hết hạn giữ chỗ và không thể thanh toán.'
    : payment.error?.message;

  return (
    <div className="mt-3 flex flex-col items-end gap-1">
      <button
        type="button"
        onClick={() => payment.mutate()}
        disabled={payment.isPending}
        className="inline-flex items-center gap-1 rounded-full bg-[#163D2C] px-4 py-1.5 text-xs font-bold text-white shadow-sm transition hover:bg-[#12331f] disabled:cursor-not-allowed disabled:opacity-60"
      >
        {payment.isPending ? 'Đang chuyển tới cổng thanh toán...' : 'Thanh toán lại →'}
      </button>
      {errorMessage && <p role="alert" className="text-xs font-medium text-rose-600">{errorMessage}</p>}
    </div>
  );
}
