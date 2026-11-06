import { ConflictException } from '@nestjs/common';
import { OrderStatus } from '../../../generated/prisma/client.js';

/**
 * Máy trạng thái đơn hàng (đề bài mục 9.1). Mỗi mũi tên trong sơ đồ là một
 * phần tử của bảng; mọi chuyển tiếp không có mũi tên bị assertTransition chặn.
 *
 *   start → PENDING ──thanh toán OK──▶ PAID ──barista nhận──▶ PREPARING
 *   PREPARING ──pha xong──▶ READY ──giao khách──▶ COMPLETED
 *   PENDING ──thanh toán lỗi──▶ PAYMENT_FAILED ──thử lại──▶ PENDING
 *   PENDING / PAYMENT_FAILED / PAID ──hủy──▶ CANCELLED
 *
 * COMPLETED và CANCELLED là trạng thái kết thúc.
 */
export const ORDER_TRANSITIONS: Readonly<
  Record<OrderStatus, readonly OrderStatus[]>
> = {
  [OrderStatus.PENDING]: [
    OrderStatus.PAID,
    OrderStatus.PAYMENT_FAILED,
    OrderStatus.CANCELLED,
  ],
  [OrderStatus.PAYMENT_FAILED]: [OrderStatus.PENDING, OrderStatus.CANCELLED],
  [OrderStatus.PAID]: [OrderStatus.PREPARING, OrderStatus.CANCELLED],
  [OrderStatus.PREPARING]: [OrderStatus.READY],
  [OrderStatus.READY]: [OrderStatus.COMPLETED],
  [OrderStatus.COMPLETED]: [],
  [OrderStatus.CANCELLED]: [],
};

/** Các trạng thái barista được phép đặt cho đơn (các bước pha chế và giao). */
export const BARISTA_TARGET_STATUSES = [
  OrderStatus.PREPARING,
  OrderStatus.READY,
  OrderStatus.COMPLETED,
] as const;

export type BaristaTargetStatus = (typeof BARISTA_TARGET_STATUSES)[number];

/** Các trạng thái hiển thị trong hàng đợi của barista. */
export const STAFF_QUEUE_STATUSES = [
  OrderStatus.PAID,
  OrderStatus.PREPARING,
  OrderStatus.READY,
] as const;

export type StaffQueueStatus = (typeof STAFF_QUEUE_STATUSES)[number];

export function canTransition(from: OrderStatus, to: OrderStatus): boolean {
  return ORDER_TRANSITIONS[from]?.includes(to) ?? false;
}

/**
 * Ném 409 INVALID_ORDER_TRANSITION nếu from → to không có trong sơ đồ.
 * Được gọi ở OrdersService (barista) và ở OrdersRepository (mọi lần ghi trạng
 * thái: thanh toán, thử lại, hết hạn, barista), nên không có đường vòng.
 */
export function assertTransition(from: OrderStatus, to: OrderStatus): void {
  if (canTransition(from, to)) return;
  throw new ConflictException({
    error: {
      code: 'INVALID_ORDER_TRANSITION',
      message: `Không thể chuyển đơn từ ${from} sang ${to}.`,
      details: [{ from, to }],
    },
  });
}

/** Lý do ghi vào lịch sử trạng thái cho từng bước của barista. */
export const BARISTA_TRANSITION_REASONS: Readonly<
  Record<BaristaTargetStatus, string>
> = {
  [OrderStatus.PREPARING]: 'Barista nhận đơn và bắt đầu pha chế',
  [OrderStatus.READY]: 'Barista pha xong, đơn sẵn sàng giao',
  [OrderStatus.COMPLETED]: 'Barista giao đơn cho khách',
};
