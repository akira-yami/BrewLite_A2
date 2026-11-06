import {
  ConflictException,
  Injectable,
} from '@nestjs/common';
import { PrismaService } from '../../../database/prisma.service.js';
import {
  OrderStatus,
  Prisma,
} from '../../../generated/prisma/client.js';
import type { OrderHistoryQueryDto } from '../dto/order-history-query.dto.js';
import { assertTransition } from '../state/order-state-machine.js';

@Injectable()
export class OrdersRepository {
  constructor(private readonly prisma: PrismaService) {}

  async lockById(id: string, tx: Prisma.TransactionClient) {
    await tx.$queryRaw`SELECT "id" FROM "orders" WHERE "id" = ${id}::uuid FOR UPDATE`;
    return tx.order.findUnique({ where: { id } });
  }

  async findByIdAndUserId(id: string, userId: string, tx?: Prisma.TransactionClient) {
    return (tx ?? this.prisma).order.findUnique({ where: { id, userId } });
  }

  async findByIdAndUserIdForUpdate(
    id: string,
    userId: string,
    tx: Prisma.TransactionClient,
  ) {
    // Khóa dòng Order trước khi kiểm tra trạng thái và tạo Payment để đồng bộ với Cron expiry.
    const lockedRows = await tx.$queryRaw<Array<{ id: string }>>`
      SELECT "id"
      FROM "orders"
      WHERE "id" = ${id}::uuid AND "user_id" = ${userId}::uuid
      FOR UPDATE
    `;

    if (lockedRows.length === 0) {
      return null;
    }

    return tx.order.findUnique({ where: { id, userId } });
  }

  async findByIdForUpdate(id: string, tx: Prisma.TransactionClient) {
    // Cron cũng khóa cùng dòng Order để không hủy đơn trong lúc Payment vừa được tạo.
    const lockedRows = await tx.$queryRaw<Array<{ id: string }>>`
      SELECT "id"
      FROM "orders"
      WHERE "id" = ${id}::uuid
      FOR UPDATE
    `;

    if (lockedRows.length === 0) {
      return null;
    }

    return tx.order.findUnique({ where: { id } });
  }

  async findOrdersByUserId(userId: string) {
    return this.prisma.order.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      include: {
        items: {
          include: {
            orderItemToppings: true,
          },
        },
      },
    });
  }

  async findOrdersPage(userId: string, query: OrderHistoryQueryDto) {
    return this.prisma.order.findMany({
      where: { userId, ...(query.status ? { status: query.status } : {}) },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: (query.limit ?? 20) + 1,
      ...(query.cursor
        ? { cursor: { id: query.cursor, userId }, skip: 1 }
        : {}),
      include: { items: { include: { orderItemToppings: true } } },
    });
  }

  /**
   * Hàng đợi của barista: sắp theo thời điểm đơn vào trạng thái hiện tại
   * (updatedAt tăng dần) để đơn chờ lâu nhất đứng đầu.
   */
  async findStaffQueue(statuses: OrderStatus[], limit: number) {
    return this.prisma.order.findMany({
      where: { status: { in: statuses } },
      orderBy: [{ updatedAt: 'asc' }, { id: 'asc' }],
      take: limit,
      include: { items: { include: { orderItemToppings: true } } },
    });
  }

  async findStaffOrder(id: string, tx: Prisma.TransactionClient) {
    return tx.order.findUnique({
      where: { id },
      include: { items: { include: { orderItemToppings: true } } },
    });
  }

  async findOrderDetail(orderId: string, userId: string) {
    return this.prisma.order.findFirst({
      where: { id: orderId, userId },
      include: {
        items: {
          include: {
            orderItemToppings: true,
          },
        },
        payments: {
          orderBy: { createdAt: 'desc' },
          select: {
            id: true,
            method: true,
            status: true,
            amount: true,
            gatewayTransactionId: true,
            processedAt: true,
            createdAt: true,
          },
        },
        statusHistories: {
          orderBy: { createdAt: 'asc' },
          select: {
            id: true,
            fromStatus: true,
            toStatus: true,
            reason: true,
            createdAt: true,
          },
        },
      },
    });
  }


async updateStatusWithHistory(
  orderId: string,
  currentStatus: OrderStatus,
  newStatus: OrderStatus,
  userId: string,
  reason: string,
  tx?: Prisma.TransactionClient,
) {
  // Cổng duy nhất của máy trạng thái: chặn chuyển tiếp không có trong sơ đồ
  // trước khi chạm DB, cho mọi luồng (thanh toán, thử lại, hết hạn, barista).
  assertTransition(currentStatus, newStatus);

  // Phần xử lý cập nhật đơn và lịch sử.
  const execute = async (
    client: Prisma.TransactionClient,
  ) => {
    const updated = await client.order.updateMany({
      where: {
        id: orderId,
        status: currentStatus,
      },
      data: {
        status: newStatus,
      },
    });

    // Ngăn hai tiến trình đồng thời cùng chuyển trạng thái đơn hàng.
    if (updated.count !== 1) {
      throw new ConflictException(
        'Order status changed; cannot update this order',
      );
    }

    // Chỉ ghi lịch sử sau khi cập nhật trạng thái thành công.
    await client.orderStatusHistory.create({
      data: {
        orderId,
        fromStatus: currentStatus,
        toStatus: newStatus,
        changedByUserId: userId,
        reason,
      },
    });
  };

  // Náº¿u Ä‘Ã£ cÃ³ transaction thÃ¬ sá»­ dá»¥ng transaction Ä‘Ã³.
  if (tx) {
    return execute(tx);
  }

  // If there is no existing transaction, create one.
  return this.prisma.$transaction(execute);
}

async markAsPaid(
  orderId: string,
  currentStatus: OrderStatus,
  userId: string,
  orderTotal: bigint,
  tx: Prisma.TransactionClient,
) {
  assertTransition(currentStatus, OrderStatus.PAID);

  // Giành quyền chuyển đơn sang PAID.
  const updated = await tx.order.updateMany({
    where: { id: orderId, status: currentStatus },
    data: { status: OrderStatus.PAID },
  });

  if (updated.count !== 1) {throw new ConflictException('Order status changed; cannot mark as paid');}

  // Ghi nhận lịch sử chuyển trạng thái sang PAID (A1-8.3 / SD-04)
  await tx.orderStatusHistory.create({
    data: {
      orderId,
      fromStatus: currentStatus,
      toStatus: OrderStatus.PAID,
      changedByUserId: userId,
      reason: 'Thanh toán thành công',
    },
  });

  // Chỉ chuyển reservation còn ACTIVE thành CONSUMED.
  await tx.inventoryReservation.updateMany({
    where: { orderId, status: 'ACTIVE' },
    data: { status: 'CONSUMED' },
  });

  // Coupon được quyết toán ở PromotionsService qua OrdersService để giữ đúng ranh giới module.

  const earnedPoints = Number(orderTotal / 10n);
  const user = await tx.user.update({
    where: { id: userId },
    data: { loyaltyBalance: { increment: earnedPoints } },
  });

  await tx.loyaltyTransaction.create({
    data: {
      userId,
      orderId,
      type: 'EARN',
      points: earnedPoints,
      balanceAfter: user.loyaltyBalance,
      reason: `Tích điểm đơn hàng ${orderId}`,
    },
  });
}
}
