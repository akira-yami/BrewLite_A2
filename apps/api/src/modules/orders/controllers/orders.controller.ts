import {
  OrdersExceptionFilter,
  OrdersResponseInterceptor,
} from '../http/orders-http.js';
import { OrderHistoryQueryDto } from '../dto/order-history-query.dto.js';
import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  UseGuards,
  Query,
  UseFilters,
  UseInterceptors,
} from '@nestjs/common';

import { OrdersService } from '../services/orders.service.js';
import { CreateOrderDto } from '../dto/create-order.dto.js';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard.js';
import { RolesGuard } from '../../auth/guards/roles.guard.js';
import { Roles } from '../../auth/decorators/roles.decorator.js';
import { CurrentUser } from '../../auth/decorators/current-user.decorator.js';
import { UserRole } from '../../../generated/prisma/client.js';

type Principal = { id: string; role: UserRole };

@Controller('orders')
@UseFilters(OrdersExceptionFilter)
@UseInterceptors(OrdersResponseInterceptor)
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.CUSTOMER)
export class OrdersController {
  constructor(private readonly orders: OrdersService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  async create(@CurrentUser() user: Principal, @Body() dto: CreateOrderDto) {
    const data = await this.orders.createOrder(user.id, dto);
    return { data };
  }

  @Get('/me')
  @HttpCode(HttpStatus.OK)
  async getMyOrders(
    @CurrentUser() user: Principal,
    @Query() query: OrderHistoryQueryDto = {},
  ) {
    return this.orders.getMyOrdersPage(user.id, query);
  }

  @Get(':id')
  @HttpCode(HttpStatus.OK)
  async getOrderDetail(
    @Param('id', ParseUUIDPipe) orderId: string,
    @CurrentUser() user: Principal,
  ) {
    const data = await this.orders.getOrderDetail(orderId, user.id);
    return { data };
  }

  @Post(':id/cancel')
  @HttpCode(HttpStatus.OK)
  async cancelOrder(
    @Param('id', ParseUUIDPipe) orderId: string,
    @CurrentUser() user: Principal,
  ) {
    // Lý do cố định từ controller — client không được tự đặt nội dung lịch sử.
    await this.orders.cancelOrder(
      orderId,
      user.id,
      'Khách hàng yêu cầu hủy đơn hàng',
      false,
    );
    const data = await this.orders.getOrderDetail(orderId, user.id);
    return { data };
  }
}
