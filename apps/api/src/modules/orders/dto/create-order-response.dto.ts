import type { OrderItemResponseDto } from './order-item-response.dto.js';
import type { OrderStatus } from '../../../generated/prisma/client.js';

export interface OrderResponseDto {
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
}

export interface CreateOrderResponseDto extends Omit<OrderResponseDto, 'status'> {
  status: 'PENDING';
}
