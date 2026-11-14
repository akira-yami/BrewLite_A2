"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useState } from "react";
import { useMutation, useQueryClient, useQuery } from "@tanstack/react-query";
import {
  cancelOrderApi,
  getOrderDetailApi,
  OrdersApiError,
} from "@/features/orders/api";
import { OrderDetailView } from "@/features/orders/components/OrderDetailView";
import { OrderPaymentRetry } from "@/features/orders/components/OrderPaymentRetry";
import { useAuthSession } from "@/features/auth/use-auth-session";
import { getCheckoutOrderItems, readPendingCheckout, writeCheckoutCoupon, writePendingCheckout } from "@/features/checkout/session";
import { cartStore } from "@/stores/cart-store";

export default function OrderDetailPage() {
  const params = useParams<{ id: string }>();
  const { status, token } = useAuthSession();
  const query = useQuery({
    queryKey: ["order-detail", token, params.id],
    enabled: status === "authenticated" && !!token && !!params.id,
    queryFn: () => getOrderDetailApi(token!, params.id!),
    retry: false,
  });
  const client = useQueryClient();
  const [confirmCancel, setConfirmCancel] = useState(false);
  const cancel = useMutation({
    mutationFn: () => cancelOrderApi(token!, params.id),
    onSuccess: async (order) => {
      setConfirmCancel(false);
      const storage = window.sessionStorage;
      const checkout = readPendingCheckout(storage);
      if (checkout?.orderId === order.id) {
        if (!checkout.cartItemsRemoved && cartStore.removeOrderItems(getCheckoutOrderItems(checkout))) {
          writeCheckoutCoupon(storage, null);
        }
        writePendingCheckout(storage, null);
      }
      await client.invalidateQueries({
        queryKey: ["order-detail", token, params.id],
      });
      await client.invalidateQueries({ queryKey: ["orders"] });
    },
    onError: () => {
      void query.refetch();
    },
  });
  const order = status === "authenticated" ? query.data : undefined;
  const error =
    status === "anonymous"
      ? "Vui lòng đăng nhập để xem đơn hàng."
      : !params.id
        ? "Không tìm thấy mã đơn hàng."
        : query.error instanceof OrdersApiError &&
            [403, 404].includes(query.error.status)
          ? "Không tìm thấy đơn hàng hoặc bạn không có quyền xem đơn này."
          : query.error?.message;

  return (
    <main className="min-h-screen bg-[#FBF8F3] px-4 py-10 sm:px-6">
      <div className="mx-auto max-w-2xl">
        <Link href="/orders" className="text-sm font-bold text-[#163D2C]">
          ← Lịch sử đơn hàng
        </Link>
        {!order && !error && (
          <div className="mt-6 rounded-2xl border border-[#E8DFC8] bg-white p-10 text-center text-sm font-semibold text-[#756A63]">
            Đang tải chi tiết đơn hàng...
          </div>
        )}
        {error && (
          <div className="mt-6 rounded-2xl border border-rose-200 bg-rose-50 p-8 text-center">
            <h1 className="font-serif text-2xl font-black text-rose-900">
              Không thể mở đơn hàng
            </h1>
            <p className="mt-2 text-sm text-rose-700">{error}</p>
            <button
              type="button"
              onClick={() => {
                if (status === "authenticated") void query.refetch();
              }}
              className="mt-5 rounded-full bg-[#163D2C] px-5 py-2.5 text-sm font-bold text-white"
            >
              Thử lại
            </button>
          </div>
        )}
        {order && (
          <div className="mt-6">
            <OrderDetailView order={order} />
            {token && <OrderPaymentRetry order={order} token={token} />}
            {["PENDING", "PAYMENT_FAILED"].includes(order.status) && (
              <section className="mt-5 rounded-2xl border border-[#E8DFC8] bg-white p-5 text-sm">
                <p className="text-[#756A63]">
                  Bạn có thể hủy đơn chưa thanh toán.
                </p>
                {confirmCancel ? (
                  <div className="mt-4 flex flex-wrap gap-3">
                    <button
                      disabled={cancel.isPending}
                      onClick={() => cancel.mutate()}
                      className="rounded-full bg-rose-700 px-4 py-2 font-semibold text-white disabled:opacity-50"
                    >
                      {cancel.isPending ? "Đang hủy…" : "Xác nhận hủy đơn"}
                    </button>
                    <button
                      disabled={cancel.isPending}
                      onClick={() => setConfirmCancel(false)}
                      className="rounded-full border px-4 py-2"
                    >
                      Giữ đơn
                    </button>
                  </div>
                ) : (
                  <button
                    onClick={() => {
                      setConfirmCancel(true);
                      cancel.reset();
                    }}
                    className="mt-4 font-semibold text-rose-700 underline"
                  >
                    Hủy đơn hàng
                  </button>
                )}
              </section>
            )}
            {cancel.error && (
              <p
                role="alert"
                className="mt-4 rounded-xl bg-rose-50 p-4 text-sm text-rose-700"
              >
                {cancel.error.message}
              </p>
            )}
          </div>
        )}
      </div>
    </main>
  );
}
