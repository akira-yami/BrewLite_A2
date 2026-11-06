import type {
  OrderStatus,
  PaymentMethod,
  PaymentStatus,
} from '../../../generated/prisma/client.js';
import type { OrderItemResponseDto } from './order-item-response.dto.js';

export interface PaymentSummaryDto {
  id: string;
  method: PaymentMethod;
  status: PaymentStatus;
  amount: number;
  gatewayTransactionId?: string | null;
  processedAt?: string | null;
  createdAt: string;
}

export interface StatusTimelineDto {
  id: string;
  fromStatus: OrderStatus | null;
  toStatus: OrderStatus;
  reason: string | null;
  createdAt: string;
}

export interface OrderDetailResponseDto {
  id: string;
  orderNumber: string;
  status: OrderStatus;
  items: OrderItemResponseDto[];
  subtotal: number;
  discountAmount: number;
  total: number;
  currency: 'VND';
  reservationExpiresAt: string;
  createdAt: string;
  paymentSummary: PaymentSummaryDto | null;
  timeline: StatusTimelineDto[];
}
