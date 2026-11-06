import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { orderMoney } from '../../../common/utils/order-money.js';
import {
  type RecipeLine,
} from '../../../common/utils/recipe-capacity.js';
import { loadAppConfig, type AppConfig } from '../../../config/app-config.js';
import { APP_CONFIG } from '../../../config/app-config.module.js';
import { PrismaService } from '../../../database/prisma.service.js';
import { OrderStatus, Prisma } from '../../../generated/prisma/client.js';
import { CatalogService } from '../../catalog/services/catalog.service.js';
import {
  InventoryService,
  InventoryVersionConflict,
  type InventoryNeeds,
} from '../../inventory/services/inventory.service.js';
import { PromotionsService } from '../../promotions/services/promotions.service.js';
import { UsersService } from '../../users/users.service.js';
import type {
  CreateOrderResponseDto,
  OrderResponseDto,
} from '../dto/create-order-response.dto.js';
import { CreateOrderDto, CreateOrderItemDto } from '../dto/create-order.dto.js';
import type {
  OrderDetailResponseDto,
  PaymentSummaryDto,
  StatusTimelineDto,
} from '../dto/order-detail-response.dto.js';
import type { OrderHistoryQueryDto } from '../dto/order-history-query.dto.js';
import type {
  StaffOrderDto,
  StaffOrdersQueryDto,
} from '../dto/staff-orders.dto.js';
import { toOrderItemResponse } from '../mappers/order-item.mapper.js';
import { OrdersRepository } from '../repositories/orders.repository.js';
import {
  BARISTA_TRANSITION_REASONS,
  STAFF_QUEUE_STATUSES,
  assertTransition,
  type BaristaTargetStatus,
} from '../state/order-state-machine.js';

@Injectable()
export class OrdersService {
  constructor(
    private readonly repository: OrdersRepository,
    private readonly prisma: PrismaService,
    private readonly promotionsService: PromotionsService,
    private readonly catalog: CatalogService,
    private readonly inventory: InventoryService,
    private readonly users: UsersService,
    @Inject(APP_CONFIG) private readonly config: AppConfig = loadAppConfig(),
  ) {}

  // =====================================================================
  // 1. NGHIỆP VỤ XỬ LÝ ĐƠN HÀNG (UC-06: TẠO ĐƠN HÀNG & GIỮ TỒN KHO)
  // =====================================================================
  async createOrder(
    userId: string,
    dto: CreateOrderDto,
  ): Promise<CreateOrderResponseDto> {
    const normalizedItems = this.normalizeItems(dto.items);
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        return await this.prisma.$transaction(
          async (tx) => {
            await this.users.assertActiveCustomer(tx, userId);
            const now = new Date();
            const reservationExpiresAt = new Date(
              now.getTime() +
                this.config.orderReservationTtlMinutes * 60 * 1000,
            );
            const orderNumber = `ORD-${randomUUID().replaceAll('-', '').slice(0, 24)}`;
            const {
              items: preparedItems,
              subtotal,
              needs,
            } = await this.validateAndPriceItems(normalizedItems, tx);
            // 3.1. Thẩm định và khóa Coupon (nếu khách hàng có áp dụng mã)
            let discountAmount = 0n;
            let couponQuote = null;

/*
*Theo biên bản phản biện kỹ thuật của Huy (docs/reviews/huy-review-coupon-sd12.md), trong transaction tạo đơn (UC-06),
  OrdersService bắt buộc phải gọi promotionsService.quoteAndLock trước để khóa dòng coupon và tính discountAmount,
  sau đó phải tx.order.create trước rồi mới gọi promotionsService.reserve để tránh lỗi vi phạm khóa ngoại FOREIGN KEY (order_id) trên bảng coupon_redemptions
*/
            if (dto.couponCode) {
              // Khóa hàng coupon trong DB, kiểm tra hạn dùng, lượt dùng và tính tiền giảm
              couponQuote = await this.promotionsService.quoteAndLock(
                tx,
                userId,
                dto.couponCode,
                subtotal,
                now,
              );
              discountAmount = couponQuote.discountAmount;
            }

            // 3.2. Tính tổng tiền thanh toán sau khi trừ giảm giá
            const total = subtotal - discountAmount;
            // Fail before writing, including component and line prices.
            [subtotal, discountAmount, total].forEach(orderMoney);

            // 3.3. Tạo bản ghi Order cùng OrderItems & OrderItemToppings
            // Lưu dưới dạng Snapshot bất biến (tên món, size, đơn giá thời điểm đặt)
            // Đảm bảo sau này catalog có đổi giá/tên thì đơn hàng cũ vẫn giữ nguyên.
            const order = await tx.order.create({
              data: {
                orderNumber,
                userId,
                status: OrderStatus.PENDING,
                subtotal,
                discountAmount,
                total,
                couponCodeSnapshot: dto.couponCode || null,
                reservationExpiresAt,
                items: {
                  create: preparedItems.map((item) => ({
                    productVariantId: item.productVariantId,
                    productNameSnapshot: item.productNameSnapshot,
                    variantNameSnapshot: item.variantNameSnapshot,
                    unitPrice: item.unitPrice,
                    quantity: item.quantity,
                    sugarLevel: item.sugarLevel,
                    iceLevel: item.iceLevel,
                    note: item.note,
                    orderItemToppings: {
                      create: item.toppings.map((t) => ({
                        toppingId: t.toppingId,
                        toppingNameSnapshot: t.toppingNameSnapshot,
                        unitPrice: t.unitPrice,
                        quantity: t.quantity,
                      })),
                    },
                  })),
                },
              },
              include: {
                items: {
                  include: {
                    orderItemToppings: true,
                  },
                },
              },
            });

            await this.inventory.reserve(
              tx,
              order.id,
              reservationExpiresAt,
              needs,
            );

            // 3.6. Giữ lượt dùng mã giảm giá (CouponRedemption) nếu có
            if (couponQuote) {
              await this.promotionsService.reserve(
                tx,
                couponQuote,
                order.id,
                reservationExpiresAt,
              );
            }

            // 3.7. Ghi nhận lịch sử trạng thái đơn hàng (Khởi tạo: null -> PENDING)
            await tx.orderStatusHistory.create({
              data: {
                orderId: order.id,
                fromStatus: null,
                toStatus: OrderStatus.PENDING,
                changedByUserId: userId,
                reason: 'Khách hàng tạo đơn hàng',
              },
            });

            return {
              id: order.id,
              orderNumber: order.orderNumber,
              status: 'PENDING',
              items: order.items.map(toOrderItemResponse),
              subtotal: orderMoney(order.subtotal),
              discountAmount: orderMoney(order.discountAmount),
              total: orderMoney(order.total),
              currency: 'VND',
              reservationExpiresAt: order.reservationExpiresAt.toISOString(),
              createdAt: order.createdAt.toISOString(),
            };
          },
          { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
        );
      } catch (error) {
        const prismaError = error as {
          code?: string;
          meta?: { target?: unknown };
        };
        const uniqueOrderNumber =
          prismaError.code === 'P2002' &&
          JSON.stringify(prismaError.meta?.target ?? '').match(
            /order_number|orderNumber/,
          );
        if (
          !(error instanceof InventoryVersionConflict) &&
          !['P2034', '40001', '40P01'].includes(prismaError.code ?? '') &&
          !uniqueOrderNumber
        )
          throw error;
        if (attempt === 2)
          throw new ConflictException({
            error: {
              code: 'INVENTORY_CONFLICT',
              message: 'Inventory changed; please try again.',
            },
          });
        await new Promise((resolve) =>
          setTimeout(resolve, 10 * (attempt + 1) + Math.random() * 20),
        );
      }
    }
    throw new Error('Unreachable retry state');
  }
  // =====================================================================
  // 2. LẤY DANH SÁCH ĐƠN HÀNG CỦA TÔI (GET /orders/me - UC-09)
  // =====================================================================
  async getMyOrders(userId: string): Promise<OrderResponseDto[]> {
    // -----------------------------------------------------------------
    // BƯỚC 1: TRUY VẤN TẤT CẢ ĐƠN HÀNG CỦA USER TỪ DATABASE
    // - Chỉ lấy đơn hàng thuộc về userId đã được xác thực qua JWT.
    // - Sắp xếp theo thời gian tạo mới nhất trước (createdAt: DESC).
    // - Tải kèm (include) toàn bộ items và topping để hiển thị đầy đủ chi tiết.
    // -----------------------------------------------------------------
    const orders = await this.repository.findOrdersByUserId(userId);

    // -----------------------------------------------------------------
    // BƯỚC 2: CHUẨN HÓA DỮ LIỆU ĐẦU RA SANG DTO
    // - Dùng toOrderItemResponse để map từng món cùng topping và tính lineTotal.
    // - Ép kiểu các trường tiền tệ từ BigInt sang Number an toàn cho JSON (tránh lỗi JSON serialization).
    // - Chuẩn hóa định dạng ngày tháng ISO string cho client.
    // -----------------------------------------------------------------
    return orders.map((order) => ({
      id: order.id,
      orderNumber: order.orderNumber,
      status: order.status,
      items: order.items.map(toOrderItemResponse),
      subtotal: orderMoney(order.subtotal),
      discountAmount: orderMoney(order.discountAmount),
      total: orderMoney(order.total),
      currency: 'VND',
      reservationExpiresAt: order.reservationExpiresAt.toISOString(),
      createdAt: order.createdAt.toISOString(),
    }));
  }

  async getMyOrdersPage(userId: string, query: OrderHistoryQueryDto) {
    const limit = query.limit ?? 20;
    const rows = await this.repository.findOrdersPage(userId, query);
    const hasMore = rows.length > limit;
    const page = rows.slice(0, limit);
    const data: OrderResponseDto[] = page.map((order) => ({
      id: order.id,
      orderNumber: order.orderNumber,
      status: order.status,
      items: order.items.map(toOrderItemResponse),
      subtotal: orderMoney(order.subtotal),
      discountAmount: orderMoney(order.discountAmount),
      total: orderMoney(order.total),
      currency: 'VND',
      reservationExpiresAt: order.reservationExpiresAt.toISOString(),
      createdAt: order.createdAt.toISOString(),
    }));
    return {
      data,
      meta: { nextCursor: hasMore ? page[page.length - 1].id : null },
    };
  }

  // =====================================================================
  // 3. CHI TIẾT ĐƠN HÀNG (GET /orders/:id - UC-09)
  // =====================================================================
  async getOrderDetail(
    orderId: string,
    userId: string,
  ): Promise<OrderDetailResponseDto> {
    // -----------------------------------------------------------------
    // BƯỚC 1: TRUY VẤN CHI TIẾT ĐƠN HÀNG KÈM CHỦ QUYỀN SỞ HỮU (OWNERSHIP)
    // - Chỉ trả về dữ liệu nếu orderId tồn tại VÀ thuộc về đúng userId.
    // - Nếu không phải chủ đơn => ném NotFoundException ('ORDER_NOT_FOUND')
    //   để tránh kẻ xấu dò quét đoán ID đơn hàng của người khác (Security Best Practice).
    // -----------------------------------------------------------------
    const order = await this.repository.findOrderDetail(orderId, userId);

    if (!order) {
      throw new NotFoundException({
        error: {
          code: 'ORDER_NOT_FOUND',
          message: 'Đơn hàng không tồn tại hoặc bạn không có quyền truy cập',
        },
      });
    }

    // -----------------------------------------------------------------
    // BƯỚC 2: TỔNG HỢP PAYMENT SUMMARY VÀ STATUS TIMELINE
    // - Payment summary: Lấy giao dịch thanh toán mới nhất (nếu có).
    // - Timeline: Danh sách lịch sử trạng thái theo thứ tự thời gian tăng dần.
    // -----------------------------------------------------------------
    const latestPayment = order.payments?.[0];
    const paymentSummary: PaymentSummaryDto | null = latestPayment
      ? {
          id: latestPayment.id,
          method: latestPayment.method,
          status: latestPayment.status,
          amount: orderMoney(latestPayment.amount),
          gatewayTransactionId: latestPayment.gatewayTransactionId ?? null,
          processedAt: latestPayment.processedAt
            ? latestPayment.processedAt.toISOString()
            : null,
          createdAt: latestPayment.createdAt.toISOString(),
        }
      : null;

    const timeline: StatusTimelineDto[] = (order.statusHistories ?? []).map(
      (history) => ({
        id: history.id,
        fromStatus: history.fromStatus,
        toStatus: history.toStatus,
        reason: history.reason,
        createdAt: history.createdAt.toISOString(),
      }),
    );

    // -----------------------------------------------------------------
    // BƯỚC 3: TRẢ VỀ DỮ LIỆU ĐẦY ĐỦ CHO CLIENT
    // -----------------------------------------------------------------
    return {
      id: order.id,
      orderNumber: order.orderNumber,
      status: order.status,
      items: order.items.map(toOrderItemResponse),
      subtotal: orderMoney(order.subtotal),
      discountAmount: orderMoney(order.discountAmount),
      total: orderMoney(order.total),
      currency: 'VND',
      reservationExpiresAt: order.reservationExpiresAt.toISOString(),
      createdAt: order.createdAt.toISOString(),
      paymentSummary,
      timeline,
    };
  }
  // =====================================================================
  // 4. NGHIỆP VỤ BARISTA (EXT-UC10): HÀNG ĐỢI VÀ CẬP NHẬT TRẠNG THÁI
  // =====================================================================

  /** Hàng đợi đơn đã thanh toán và đang xử lý, đơn chờ lâu nhất đứng đầu. */
  async getStaffQueue(
    query: StaffOrdersQueryDto,
    baristaId: string,
  ): Promise<{ data: StaffOrderDto[] }> {
    await this.users.assertActiveBarista(this.prisma, baristaId);
    const statuses = query.status ? [query.status] : [...STAFF_QUEUE_STATUSES];
    const orders = await this.repository.findStaffQueue(
      statuses,
      query.limit ?? 100,
    );
    return { data: orders.map((order) => this.toStaffOrder(order)) };
  }

  /**
   * Barista chuyển đơn sang bước tiếp theo: PAID → PREPARING → READY → COMPLETED.
   * Khóa dòng đơn, kiểm tra luật chuyển trạng thái rồi ghi lịch sử trong cùng
   * transaction. Hai barista bấm cùng lúc thì người đến sau nhận 409.
   */
  async advanceOrderStatus(
    orderId: string,
    baristaId: string,
    toStatus: BaristaTargetStatus,
  ): Promise<StaffOrderDto> {
    return this.prisma.$transaction(async (tx) => {
      await this.users.assertActiveBarista(tx, baristaId);

      const order = await this.repository.lockById(orderId, tx);
      if (!order) {
        throw new NotFoundException({
          error: {
            code: 'ORDER_NOT_FOUND',
            message: 'Đơn hàng không tồn tại.',
          },
        });
      }

      assertTransition(order.status, toStatus);

      await this.repository.updateStatusWithHistory(
        order.id,
        order.status,
        toStatus,
        baristaId,
        BARISTA_TRANSITION_REASONS[toStatus],
        tx,
      );

      const updated = await this.repository.findStaffOrder(order.id, tx);
      if (!updated) throw new Error('Order disappeared during status update');
      return this.toStaffOrder(updated);
    });
  }

  private toStaffOrder(
    order: Prisma.OrderGetPayload<{
      include: { items: { include: { orderItemToppings: true } } };
    }>,
  ): StaffOrderDto {
    return {
      id: order.id,
      orderNumber: order.orderNumber,
      status: order.status,
      items: order.items.map(toOrderItemResponse),
      total: orderMoney(order.total),
      currency: 'VND',
      createdAt: order.createdAt.toISOString(),
      updatedAt: order.updatedAt.toISOString(),
    };
  }

  /**
   * Hủy đơn hàng — dùng chung cho cả luồng khách hủy chủ động và cron expiry.
   *
   * Khi `tx` được cung cấp (ví dụ: cron expiry gọi từ bên trong transaction của
   * nó), thao tác chạy trong transaction đó.  Khi không có `tx`, hàm tự mở một
   * transaction mới (luồng khách hủy qua HTTP).
   *
   * @param reason   Lý do hủy ghi vào lịch sử trạng thái.
   * @param isExpiry true → phân loại reservation là EXPIRED; false → RELEASED.
   * @param tx       Transaction client tuỳ chọn (cron truyền vào).
   */
  private normalizeItems(items: CreateOrderItemDto[]): CreateOrderItemDto[] {
    const grouped = new Map<string, CreateOrderItemDto>();
    for (const item of items) {
      const toppingIds = (item.toppingIds ?? [])
        .map((id) => id.toLowerCase())
        .sort();
      if (new Set(toppingIds).size !== toppingIds.length) {
        throw new BadRequestException({
          error: { code: 'VALIDATION_ERROR', message: 'Duplicate toppings.' },
        });
      }
      const normalized = {
        quantity: item.quantity,
        productVariantId: item.productVariantId.toLowerCase(),
        toppingIds,
        sugarLevel: item.sugarLevel ?? null,
        iceLevel: item.iceLevel ?? null,
        note: item.note?.trim() || null,
      };
      const key = JSON.stringify([
        normalized.productVariantId,
        toppingIds,
        normalized.sugarLevel,
        normalized.iceLevel,
        normalized.note,
      ]);
      const previous = grouped.get(key);
      if (previous) previous.quantity += normalized.quantity;
      else grouped.set(key, normalized);
      if ((grouped.get(key)?.quantity ?? 0) > 20) {
        throw new BadRequestException({
          error: {
            code: 'VALIDATION_ERROR',
            message: 'At most 20 drinks per configuration.',
          },
        });
      }
    }
    return [...grouped.values()];
  }

  async validateAndPriceItems(
    items: CreateOrderItemDto[],
    tx: Prisma.TransactionClient = this.prisma,
  ) {
    const preparedItems = [];
    // Nhu cầu nguyên liệu suy ra từ công thức (BOM); không có tồn kho thành phẩm.
    const needs: InventoryNeeds = {
      ingredients: new Map(),
      variants: new Map(),
    };
    const ingredientStock = new Map<string, number>();
    type QuotedRecipeLine = RecipeLine & { ingredientId: string };
    const quotedRecipes = new Map<string, QuotedRecipeLine[]>();
    const quotedToppingRecipes = new Map<string, QuotedRecipeLine[]>();

    let subtotal = 0n;

    for (const item of items) {
      // 1. Tìm size và sản phẩm đang hoạt động trong database.
      const variant = await this.catalog.quoteVariant(
        tx,
        item.productVariantId,
      );

      if (!variant) {
        throw new BadRequestException({
          error: {
            code: 'INVALID_OPTION',
            message: 'Product variant not found or unavailable',
          },
        });
      }

      // 2. Quy đổi số ly thành nhu cầu nguyên liệu theo công thức (BOM).
      // Cộng dồn nếu nhiều dòng chọn cùng size hoặc dùng chung nguyên liệu.
      const variantId = variant.id;
      quotedRecipes.set(variantId, variant.recipeItems);

      const variantNeed = needs.variants.get(variantId) ?? {
        quantity: 0,
        ingredients: new Map<string, number>(),
      };
      variantNeed.quantity += item.quantity;
      needs.variants.set(variantId, variantNeed);

      const addNeed = (
        line: {
          ingredientId: string;
          quantity: number;
          ingredient: { stockQuantity: number; version: number };
        },
        cups: number,
      ) => {
        const amount = line.quantity * cups;
        const ingredientId = line.ingredientId;
        variantNeed.ingredients.set(
          ingredientId,
          (variantNeed.ingredients.get(ingredientId) ?? 0) + amount,
        );
        const total = needs.ingredients.get(ingredientId);
        needs.ingredients.set(ingredientId, {
          quantity: (total?.quantity ?? 0) + amount,
          version: line.ingredient.version,
        });
        ingredientStock.set(ingredientId, line.ingredient.stockQuantity);
      };

      for (const line of variant.recipeItems) addNeed(line, item.quantity);

      // 3. Kiểm tra topping thuộc sản phẩm và đang hoạt động.
      const selectedToppings = (item.toppingIds ?? []).map((toppingId) => {
        const relation = variant.product.productToppings.find(
          (productTopping) =>
            productTopping.topping.id === toppingId &&
            productTopping.topping.isActive,
        );

        if (!relation) {
          throw new BadRequestException({
            error: {
              code: 'INVALID_OPTION',
              message: 'Topping is not available for this product',
            },
          });
        }

        return relation.topping;
      });

      // 3b. Mỗi ly kèm 1 phần topping: quy đổi theo công thức topping (nhập sẵn
      // hoặc chế biến) và gộp vào nhu cầu nguyên liệu của dòng giữ chỗ này.
      for (const topping of selectedToppings) {
        quotedToppingRecipes.set(topping.id, topping.recipeItems);
        for (const line of topping.recipeItems) addNeed(line, item.quantity);
      }

      // 4. Lấy giá từ database, không nhận giá từ frontend.
      const toppingTotal = selectedToppings.reduce(
        (sum, topping) => sum + topping.price,
        0n,
      );

      const lineTotal = (variant.price + toppingTotal) * BigInt(item.quantity);

      [
        variant.price,
        lineTotal,
        ...selectedToppings.map((t) => t.price),
      ].forEach(orderMoney);
      subtotal += lineTotal;
      orderMoney(subtotal);

      // 5. Chuẩn bị dữ liệu để tạo OrderItem và OrderItemTopping.
      preparedItems.push({
        productVariantId: variant.id,
        productNameSnapshot: variant.product.name,
        variantNameSnapshot: variant.size,
        unitPrice: variant.price,
        quantity: item.quantity,
        sugarLevel: item.sugarLevel ?? null,
        iceLevel: item.iceLevel ?? null,
        note: item.note?.trim() || null,
        toppings: selectedToppings.map((topping) => ({
          toppingId: topping.id,
          toppingNameSnapshot: topping.name,
          unitPrice: topping.price,
          quantity: 1,
        })),
      });
    }

    // 6. Kiểm tra tổng nhu cầu nguyên liệu với tồn kho nguyên liệu hiện tại.
    // Variant chưa có công thức hoặc dùng nguyên liệu ngừng dùng thì không bán được.
    // Topping chưa có công thức hoặc thiếu nguyên liệu cũng không bán được.
    const isShort = (recipe: QuotedRecipeLine[]) =>
      recipe.length === 0 ||
      recipe.some(
        (line) =>
          !line.ingredient.isActive ||
          (needs.ingredients.get(line.ingredientId)?.quantity ?? 0) >
            (ingredientStock.get(line.ingredientId) ?? 0),
      );
    const unavailable: Array<{
      variantId?: string;
      toppingId?: string;
      available: false;
    }> = [];
    for (const [variantId, recipe] of quotedRecipes) {
      if (isShort(recipe)) {
        unavailable.push({ variantId, available: false });
      }
    }
    for (const [toppingId, recipe] of quotedToppingRecipes) {
      if (isShort(recipe)) {
        unavailable.push({ toppingId, available: false });
      }
    }

    if (unavailable.length > 0) {
      throw new ConflictException({
        error: {
          code: 'OUT_OF_STOCK',
          message: 'Insufficient ingredients',
          details: unavailable,
        },
      });
    }

    return {
      items: preparedItems,
      subtotal,
      needs,
    };
  }

  // =====================================================================
  // 2. CỔNG GIAO TIẾP CHO MODULE THANH TOÁN (PAYMENT TRANSITIONS)
  // =====================================================================

  async getOrderForPayment(
    orderId: string,
    userId: string,
    tx?: Prisma.TransactionClient,
  ) {
    if (tx) await this.repository.lockById(orderId, tx);
    const order = await this.repository.findByIdAndUserId(orderId, userId, tx);
    if (!order) {
      throw new NotFoundException(
        'Đơn hàng không tồn tại hoặc bạn không có quyền truy cập',
      );
    }
    return order;
  }

  async getOrderForPaymentForUpdate(
    orderId: string,
    userId: string,
    tx: Prisma.TransactionClient,
  ) {
    // Bảo đảm kiểm tra Order và ghi Payment PROCESSING diễn ra dưới cùng khóa dòng.
    const order = await this.repository.findByIdAndUserIdForUpdate(
      orderId,
      userId,
      tx,
    );
    if (!order) {
      throw new NotFoundException(
        'Đơn hàng không tồn tại hoặc bạn không có quyền truy cập',
      );
    }
    return order;
  }

  async transitionForPaymentRetry(
    orderId: string,
    userId: string,
    reason: string,
    tx?: Prisma.TransactionClient,
  ) {
    // Chỉ truyền transaction khi có transaction do PaymentsService quản lý.
    if (tx) {
      await this.repository.updateStatusWithHistory(
        orderId,
        OrderStatus.PAYMENT_FAILED,
        OrderStatus.PENDING,
        userId,
        reason,
        tx,
      );
      return;
    }

    // Giữ nguyên lời gọi 5 tham số cho các luồng và test cũ không dùng transaction.
    await this.repository.updateStatusWithHistory(
      orderId,
      OrderStatus.PAYMENT_FAILED,
      OrderStatus.PENDING,
      userId,
      reason,
      tx,
    );
  }

  async markOrderPaid(
    orderId: string,
    userId: string,
    orderTotal: bigint,
    tx: Prisma.TransactionClient,
  ) {
    // 1. Đánh dấu đơn hàng là PAID và xử lý Loyalty, Inventory (bên trong repository)
    await this.repository.markAsPaid(
      orderId,
      OrderStatus.PENDING,
      userId,
      orderTotal,
      tx,
    );

    // 2. Quyết toán Coupon: Gọi chéo sang PromotionsService theo đúng chuẩn Dependency Map (ADR-001)
    await this.promotionsService.consumeRedemption(tx, orderId);
  }

  async markOrderPaymentFailed(
    orderId: string,
    userId: string,
    reason: string,
    tx: Prisma.TransactionClient,
  ) {
    await this.repository.updateStatusWithHistory(
      orderId,
      OrderStatus.PENDING,
      OrderStatus.PAYMENT_FAILED,
      userId,
      reason,
      tx,
    );
  }

  // =====================================================================
  // 4. HỦY ĐƠN HÀNG VÀ GIẢI PHÓNG TÀI NGUYÊN (UC-06 / CRONJOB)
  // =====================================================================
  async cancelOrder(
    orderId: string,
    userId: string,
    reason: string,
    isExpired: boolean,
    tx?: Prisma.TransactionClient,
  ) {
    // Khóa Order trong transaction để đồng bộ thao tác hủy với Payment và Cron expiry.
    const execute = async (client: Prisma.TransactionClient) => {
      const order = await this.repository.findByIdAndUserIdForUpdate(
        orderId,
        userId,
        client,
      );

      if (!order) {
        throw new NotFoundException({
          error: {
            code: 'ORDER_NOT_FOUND',
            message: 'Đơn hàng không tồn tại hoặc bạn không có quyền truy cập.',
          },
        });
      }

      // Không cho hủy đơn đã thanh toán; luồng hoàn tiền cần được xử lý riêng.
      if (
        order.status !== OrderStatus.PENDING &&
        order.status !== OrderStatus.PAYMENT_FAILED
      ) {
        throw new ConflictException({
          code: 'ORDER_INVALID_TRANSITION',
          message: 'Trạng thái đơn hàng không cho phép hủy.',
        });
      }

      // Payment đang PROCESSING phải hoàn tất trước khi Order được phép hủy.
      const processingPayment = await client.payment.findFirst({
        where: {
          orderId,
          status: { in: ['PROCESSING', 'MANUAL_REVIEW'] },
        },
        select: { id: true },
      });
      if (processingPayment) {
        throw new ConflictException({
          code: 'PAYMENT_IN_PROGRESS',
          message: 'Đơn hàng đang được thanh toán, không thể hủy lúc này.',
        });
      }

      // Lấy reservation còn ACTIVE để giải phóng kho trong cùng transaction.
      const reservations = await client.inventoryReservation.findMany({
        where: { orderId, status: 'ACTIVE' },
        select: { id: true, expiresAt: true },
      });
      const now = new Date();
      const couponExpired = isExpired || order.reservationExpiresAt <= now;

      await this.repository.updateStatusWithHistory(
        orderId,
        order.status,
        OrderStatus.CANCELLED,
        userId,
        reason,
        client,
      );

      // Coupon được RELEASED khi hủy chủ động, hoặc EXPIRED nếu đã quá deadline.
      await this.promotionsService.releaseRedemption(
        client,
        orderId,
        couponExpired,
      );

      // Chỉ reservation còn ACTIVE mới được release/restore stock đúng một lần.
      for (const reservation of reservations) {
        const reservationExpired =
          isExpired ||
          order.reservationExpiresAt <= now ||
          reservation.expiresAt <= now;
        await this.inventory.releaseInTransaction(
          client,
          reservation.id,
          reservationExpired,
        );
      }
    };

    // Tôn trọng transaction từ caller; nếu không có thì tự tạo transaction nguyên tử.
    if (tx) {
      return execute(tx);
    }
    return this.prisma.$transaction(execute);
  }
}
