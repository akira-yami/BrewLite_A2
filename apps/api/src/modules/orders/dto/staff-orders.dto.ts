import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, Max, Min } from 'class-validator';
import {
  BARISTA_TARGET_STATUSES,
  STAFF_QUEUE_STATUSES,
  type BaristaTargetStatus,
  type StaffQueueStatus,
} from '../state/order-state-machine.js';
import type { OrderStatus } from '../../../generated/prisma/client.js';
import type { OrderItemResponseDto } from './order-item-response.dto.js';

export class StaffOrdersQueryDto {
  /** Lọc theo một trạng thái trong hàng đợi; bỏ trống để lấy PAID, PREPARING, READY. */
  @IsOptional()
  @IsIn(STAFF_QUEUE_STATUSES)
  status?: StaffQueueStatus;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  limit?: number;
}

export class UpdateOrderStatusDto {
  @IsIn(BARISTA_TARGET_STATUSES)
  status!: BaristaTargetStatus;
}

/** Dữ liệu đơn dành cho nhân viên: không chứa thông tin tài khoản khách. */
export interface StaffOrderDto {
  id: string;
  orderNumber: string;
  status: OrderStatus;
  items: OrderItemResponseDto[];
  total: number;
  currency: 'VND';
  createdAt: string;
  updatedAt: string;
}
