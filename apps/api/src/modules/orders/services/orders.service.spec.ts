import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PrismaService } from '../../../database/prisma.service.js';
import { OrderStatus } from '../../../generated/prisma/client.js';
import { CatalogService } from '../../catalog/services/catalog.service.js';
import { InventoryService } from '../../inventory/services/inventory.service.js';
import { InventoryRepository } from '../../inventory/repositories/inventory.repository.js';
import { PromotionsService } from '../../promotions/services/promotions.service.js';
import { UsersService } from '../../users/users.service.js';
import { OrdersRepository } from '../repositories/orders.repository.js';
import { OrdersService } from './orders.service.js';

// Một dòng công thức: `quantity` đơn vị nguyên liệu cho mỗi ly, kho còn `stockQuantity`.
function recipeLine(quantity: number, stockQuantity: number) {
  return {
    ingredientId: 'ingredient-1',
    quantity,
    ingredient: {
      id: 'ingredient-1',
      stockQuantity,
      version: 0,
      isActive: true,
    },
  };
}

describe('OrdersService- Cổng thanh toán (Unit Test - TDD)', () => {
  let service: OrdersService;
  let prismaMock: any;
  let txMock: any;
  let promotionsServiceMock: any;

  // Mock OrdersRepository
  const repository = {
    findActiveVariantById: vi.fn(),
    findByIdAndUserId: vi.fn(),
    findByIdAndUserIdForUpdate: vi.fn(),
    updateStatusWithHistory: vi.fn(),
    markAsPaid: vi.fn(),
    findOrdersByUserId: vi.fn(),
    findOrderDetail: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();

    // Mock transaction client
    txMock = {
      user: {
        findFirst: vi.fn().mockResolvedValue({ id: 'u-1' }),
      },

      order: {
        create: vi.fn(),
      },
      productVariant: {},
      ingredient: {
        updateMany: vi.fn(),
        update: vi.fn(),
      },

      inventoryReservation: {
        create: vi.fn(),
        findMany: vi.fn(),
        findUnique: vi.fn(),
        updateMany: vi.fn(),
      },

      payment: {
        findFirst: vi.fn(),
      },

      orderStatusHistory: {
        create: vi.fn(),
      },
    };

    // Mock PrismaService
    prismaMock = {
      productVariant: txMock.productVariant,

      $transaction: vi.fn(async (cb: any) => cb(txMock)),
    };

    // Mock PromotionsService
    promotionsServiceMock = {
      quoteAndLock: vi.fn(),
      reserve: vi.fn(),
      // Mô phỏng cổng quyết toán coupon khi thanh toán thành công và khi hủy đơn.
      consumeRedemption: vi.fn(),
      releaseRedemption: vi.fn(),
    };

    // CatalogService vẫn được sử dụng để kiểm tra và tính giá sản phẩm.
    const catalog = new CatalogService({} as any);

    txMock.productVariant.findFirst = repository.findActiveVariantById;

    // Khởi tạo OrdersService
    service = new OrdersService(
      repository as unknown as OrdersRepository,
      prismaMock as unknown as PrismaService,
      promotionsServiceMock as unknown as PromotionsService,
      catalog,
      new InventoryService(
        prismaMock as PrismaService,
        new InventoryRepository({} as never),
      ),
      new UsersService(),
    );

    // Dữ liệu sản phẩm mặc định cho các bài test
    repository.findActiveVariantById.mockResolvedValue({
      id: 'variant-1',
      size: 'M',
      price: 35000n,
      // Công thức: 10g cà phê mỗi ly; kho có 100g => tối đa 10 ly.
      recipeItems: [recipeLine(10, 100)],
      product: {
        name: 'Cà phê sữa',
        productToppings: [
          {
            topping: {
              id: 'topping-1',
              name: 'Trân châu',
              price: 8000n,
              isActive: true,
              // Topping nhập sẵn: 1 phần = 30g trân châu 3Q, kho còn 300g.
              recipeItems: [
                {
                  ingredientId: 'pearl',
                  quantity: 30,
                  ingredient: {
                    id: 'pearl',
                    stockQuantity: 300,
                    version: 2,
                    isActive: true,
                  },
                },
              ],
            },
          },
        ],
      },
    });
  });

  // ==========================================
  // CÁC BÀI TEST CŨ CỦA VALIDATE & PRICE ITEMS
  // ==========================================
  describe('validateAndPriceItems', () => {
    it('tính đúng giá size và topping', async () => {
      const result = await service.validateAndPriceItems([
        {
          productVariantId: 'variant-1',
          quantity: 2,
          toppingIds: ['topping-1'],
        },
      ]);

      expect(result.subtotal).toBe(86000n);
      expect(result.items).toHaveLength(1);
      expect(result.items[0].unitPrice).toBe(35000n);
    });

    it('từ chối topping không thuộc sản phẩm', async () => {
      await expect(
        service.validateAndPriceItems([
          {
            productVariantId: 'variant-1',
            quantity: 1,
            toppingIds: ['topping-khong-hop-le'],
          },
        ]),
      ).rejects.toThrow(BadRequestException);
    });

    it('từ chối size không tồn tại hoặc không hoạt động', async () => {
      repository.findActiveVariantById.mockResolvedValue(null);

      await expect(
        service.validateAndPriceItems([
          {
            productVariantId: 'variant-khong-hop-le',
            quantity: 1,
          },
        ]),
      ).rejects.toThrow(BadRequestException);
    });

    it('từ chối topping đã ngừng hoạt động', async () => {
      repository.findActiveVariantById.mockResolvedValue({
        id: 'variant-1',
        size: 'M',
        price: 35000n,
        recipeItems: [recipeLine(10, 100)],
        product: {
          name: 'Cà phê sữa',
          productToppings: [
            {
              topping: {
                id: 'topping-1',
                name: 'Trân châu',
                price: 8000n,
                isActive: false,
              },
            },
          ],
        },
      });

      await expect(
        service.validateAndPriceItems([
          {
            productVariantId: 'variant-1',
            quantity: 1,
            toppingIds: ['topping-1'],
          },
        ]),
      ).rejects.toThrow(BadRequestException);
    });

    it('từ chối size chưa có công thức vì không tính được nguyên liệu', async () => {
      repository.findActiveVariantById.mockResolvedValue({
        id: 'variant-1',
        size: 'M',
        price: 35000n,
        recipeItems: [],
        product: { name: 'Cà phê sữa', productToppings: [] },
      });

      await expect(
        service.validateAndPriceItems([
          { productVariantId: 'variant-1', quantity: 1 },
        ]),
      ).rejects.toThrow(ConflictException);
    });

    it('tính nhu cầu nguyên liệu theo công thức và cộng dồn các dòng cùng size', async () => {
      const result = await service.validateAndPriceItems([
        { productVariantId: 'variant-1', quantity: 3 },
        { productVariantId: 'variant-1', quantity: 2, sugarLevel: 0 },
      ]);

      expect(result.needs.ingredients.get('ingredient-1')).toEqual({
        quantity: 50,
        version: 0,
      });
      expect(result.needs.variants.get('variant-1')).toEqual({
        quantity: 5,
        ingredients: new Map([['ingredient-1', 50]]),
      });
    });

    describe('topping theo công thức', () => {
      const lineOf = (
        ingredientId: string,
        quantity: number,
        stockQuantity: number,
      ) => ({
        ingredientId,
        quantity,
        ingredient: {
          id: ingredientId,
          stockQuantity,
          version: 0,
          isActive: true,
        },
      });
      const variantWith = (toppingRecipe: unknown[]) => ({
        id: 'variant-1',
        size: 'M',
        price: 35000n,
        recipeItems: [
          lineOf('ingredient-1', 10, 100),
          lineOf('milk', 20, 1000),
        ],
        product: {
          name: 'Trà sữa',
          productToppings: [
            {
              topping: {
                id: 'topping-1',
                name: 'Trân châu đen',
                price: 8000n,
                isActive: true,
                recipeItems: toppingRecipe,
              },
            },
          ],
        },
      });
      const order = {
        productVariantId: 'variant-1',
        quantity: 2,
        toppingIds: ['topping-1'],
      };

      it('topping nhập sẵn: 1 phần = 1 định lượng nguyên liệu thô', async () => {
        repository.findActiveVariantById.mockResolvedValue(
          variantWith([lineOf('pearl', 30, 300)]),
        );

        const { needs } = await service.validateAndPriceItems([order]);

        // 2 ly x 1 phần x 30g trân châu 3Q.
        expect(needs.ingredients.get('pearl')).toEqual({
          quantity: 60,
          version: 0,
        });
      });

      it('topping chế biến: bán thành phẩm gồm nhiều nguyên liệu, gộp với nguyên liệu dùng chung của ly', async () => {
        repository.findActiveVariantById.mockResolvedValue(
          variantWith([
            lineOf('tapioca', 20, 1000),
            lineOf('brown-sugar', 15, 1000),
            // Sữa tươi dùng chung với công thức của ly.
            lineOf('milk', 10, 1000),
          ]),
        );

        const { needs } = await service.validateAndPriceItems([order]);

        expect(needs.ingredients.get('tapioca')?.quantity).toBe(40);
        expect(needs.ingredients.get('brown-sugar')?.quantity).toBe(30);
        // Ly: 2 x 20ml + topping: 2 x 10ml.
        expect(needs.ingredients.get('milk')?.quantity).toBe(60);
        expect(needs.variants.get('variant-1')?.ingredients.get('milk')).toBe(
          60,
        );
      });

      it('từ chối khi topping thiếu một nguyên liệu dù ly vẫn đủ', async () => {
        repository.findActiveVariantById.mockResolvedValue(
          variantWith([
            lineOf('tapioca', 20, 1000),
            // Cần 2 x 15 = 30g nhưng chỉ còn 20g.
            lineOf('brown-sugar', 15, 20),
          ]),
        );

        await expect(
          service.validateAndPriceItems([order]),
        ).rejects.toMatchObject({
          response: {
            error: {
              code: 'OUT_OF_STOCK',
              details: [{ toppingId: 'topping-1', available: false }],
            },
          },
        });
      });

      it('từ chối topping chưa có công thức', async () => {
        repository.findActiveVariantById.mockResolvedValue(variantWith([]));

        await expect(service.validateAndPriceItems([order])).rejects.toThrow(
          ConflictException,
        );
      });
    });

    it('từ chối khi tổng số lượng cùng size vượt tồn kho', async () => {
      await expect(
        service.validateAndPriceItems([
          {
            productVariantId: 'variant-1',
            quantity: 6,
          },
          {
            productVariantId: 'variant-1',
            quantity: 5,
          },
        ]),
      ).rejects.toThrow(ConflictException);
    });

    it('từ chối khi số lượng vượt tồn kho', async () => {
      await expect(
        service.validateAndPriceItems([
          {
            productVariantId: 'variant-1',
            quantity: 11,
          },
        ]),
      ).rejects.toThrow(ConflictException);
    });
  });

  // ==========================================
  // CÁC BÀI TEST MỚI CHO GIAO TIẾP THANH TOÁN
  // ==========================================
  describe('Cổng giao tiếp thanh toán (Payment Transitions)', () => {
    const mockOrder = {
      id: 'o-1',
      userId: 'u-1',
      status: OrderStatus.PENDING,
      total: 100000n,
    };

    // Transaction mock phục vụ cả các test transition và thao tác cancel có đọc Payment/Inventory.
    const paymentTxMock = {
      payment: {
        findFirst: vi.fn(),
      },
      inventoryReservation: {
        findMany: vi.fn(),
        findUnique: vi.fn(),
        updateMany: vi.fn(),
      },
      ingredient: {
        update: vi.fn(),
      },
    } as any;

    it('getOrderForPayment - ném NotFoundException nếu không tìm thấy đơn hoặc sai userId', async () => {
      repository.findByIdAndUserId.mockResolvedValue(null);

      await expect(service.getOrderForPayment('o-1', 'u-1')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('getOrderForPayment - trả về order nếu hợp lệ', async () => {
      repository.findByIdAndUserId.mockResolvedValue(mockOrder);

      const result = await service.getOrderForPayment('o-1', 'u-1');

      expect(result).toEqual(mockOrder);
    });

    it('getOrderForPaymentForUpdate - khóa Order trong transaction và trả về đúng chủ đơn', async () => {
      repository.findByIdAndUserIdForUpdate.mockResolvedValue(mockOrder);

      const result = await service.getOrderForPaymentForUpdate(
        'o-1',
        'u-1',
        paymentTxMock,
      );

      expect(repository.findByIdAndUserIdForUpdate).toHaveBeenCalledWith(
        'o-1',
        'u-1',
        paymentTxMock,
      );
      expect(result).toEqual(mockOrder);
    });

    it('transitionForPaymentRetry - gọi updateStatusWithHistory chuyển từ PAYMENT_FAILED sang PENDING', async () => {
      await service.transitionForPaymentRetry(
        'o-1',
        'u-1',
        'Thử lại thanh toán',
      );

      expect(repository.updateStatusWithHistory).toHaveBeenCalledWith(
        'o-1',
        OrderStatus.PAYMENT_FAILED,
        OrderStatus.PENDING,
        'u-1',
        'Thử lại thanh toán',
        undefined,
      );
    });

    it('transitionForPaymentRetry - truyền transaction khi được cung cấp', async () => {
      await service.transitionForPaymentRetry(
        'o-1',
        'u-1',
        'Retry trong transaction',
        paymentTxMock,
      );

      expect(repository.updateStatusWithHistory).toHaveBeenCalledWith(
        'o-1',
        OrderStatus.PAYMENT_FAILED,
        OrderStatus.PENDING,
        'u-1',
        'Retry trong transaction',
        paymentTxMock,
      );
    });

    it('markOrderPaid - gọi markAsPaid chuyển từ PENDING sang PAID', async () => {
      await service.markOrderPaid('o-1', 'u-1', 100000n, paymentTxMock);

      expect(repository.markAsPaid).toHaveBeenCalledWith(
        'o-1',
        OrderStatus.PENDING,
        'u-1',
        100000n,
        paymentTxMock,
      );
      expect(promotionsServiceMock.consumeRedemption).toHaveBeenCalledWith(
        paymentTxMock,
        'o-1',
      );
      // Mỗi luồng thanh toán thành công chỉ consume coupon đúng một lần trong cùng transaction.
      expect(promotionsServiceMock.consumeRedemption).toHaveBeenCalledTimes(1);
    });

    it('cancelOrder - khóa Order, đổi CANCELLED, release coupon và hoàn kho trong cùng transaction', async () => {
      // Giả lập Order còn hạn, không có Payment PROCESSING và có một reservation ACTIVE.
      const reservationExpiry = new Date(Date.now() + 60_000);
      repository.findByIdAndUserIdForUpdate.mockResolvedValue({
        id: 'o-1',
        userId: 'u-1',
        status: OrderStatus.PENDING,
        reservationExpiresAt: reservationExpiry,
      });
      paymentTxMock.payment.findFirst.mockResolvedValue(null);
      paymentTxMock.inventoryReservation.findMany.mockResolvedValue([
        { id: 'r-1', expiresAt: reservationExpiry },
      ]);
      paymentTxMock.inventoryReservation.findUnique.mockResolvedValue({
        id: 'r-1',
        status: 'ACTIVE',
        expiresAt: reservationExpiry,
        items: [
          {
            ingredientId: 'ingredient-1',
            quantity: 20,
          },
        ],
      });

      paymentTxMock.inventoryReservation.updateMany.mockResolvedValue({
        count: 1,
      });

      paymentTxMock.ingredient.update.mockResolvedValue({});

      await service.cancelOrder('o-1', 'u-1', 'Khách hàng hủy đơn', false, paymentTxMock);

      // Xác nhận cùng transaction khóa Order, cập nhật history, release coupon và inventory.
      expect(repository.findByIdAndUserIdForUpdate).toHaveBeenCalledWith(
        'o-1',
        'u-1',
        paymentTxMock,
      );
      expect(repository.updateStatusWithHistory).toHaveBeenCalledWith(
        'o-1',
        OrderStatus.PENDING,
        OrderStatus.CANCELLED,
        'u-1',
        'Khách hàng hủy đơn',
        paymentTxMock,
      );
      expect(promotionsServiceMock.releaseRedemption).toHaveBeenCalledWith(
        paymentTxMock,
        'o-1',
        false,
      );

      expect(paymentTxMock.inventoryReservation.updateMany,).toHaveBeenCalledWith({
        where: {
          id: 'r-1',
          status: 'ACTIVE',
          expiresAt: {gt: expect.any(Date),},
        },
        data: {status: 'RELEASED',},
      });

      expect(paymentTxMock.ingredient.update).toHaveBeenCalledWith({
        where: {id: 'ingredient-1',},
        data: {
          stockQuantity: {increment: 20,},
          version: {increment: 1,},
        },
      });


    });

    it('cancelOrder - không hủy Order khi Payment vẫn PROCESSING', async () => {
      repository.findByIdAndUserIdForUpdate.mockResolvedValue({
        id: 'o-1',
        userId: 'u-1',
        status: OrderStatus.PENDING,
        reservationExpiresAt: new Date(Date.now() + 60_000),
      });
      paymentTxMock.payment.findFirst.mockResolvedValue({ id: 'payment-1' });

      await expect(
        service.cancelOrder('o-1', 'u-1', 'Khách hàng hủy đơn', false, paymentTxMock),
      ).rejects.toThrow(ConflictException);

      expect(repository.updateStatusWithHistory).not.toHaveBeenCalled();
      expect(promotionsServiceMock.releaseRedemption).not.toHaveBeenCalled();

      expect(paymentTxMock.ingredient.update).not.toHaveBeenCalled();

      expect(paymentTxMock.inventoryReservation.updateMany,).not.toHaveBeenCalled();

    });

    it('markOrderPaymentFailed - gọi updateStatusWithHistory chuyển từ PENDING sang PAYMENT_FAILED', async () => {
      await service.markOrderPaymentFailed(
        'o-1',
        'u-1',
        'Lỗi thanh toán Gateway',
        paymentTxMock,
      );

      expect(repository.updateStatusWithHistory).toHaveBeenCalledWith(
        'o-1',
        OrderStatus.PENDING,
        OrderStatus.PAYMENT_FAILED,
        'u-1',
        'Lỗi thanh toán Gateway',
        paymentTxMock,
      );
    });


    it('cancelOrder (Hết hạn 15 phút) - release coupon EXPIRED trong transaction', async () => {
      // Chuẩn bị đơn còn ở trạng thái PENDING nhưng đã quá deadline 15 phút.
      repository.findByIdAndUserIdForUpdate.mockResolvedValue({
        id: 'o-1',
        userId: 'u-1',
        status: OrderStatus.PENDING,
        reservationExpiresAt: new Date(Date.now() - 15 * 60 * 1000),
      });
      paymentTxMock.payment.findFirst.mockResolvedValue(null);
      paymentTxMock.inventoryReservation.findMany.mockResolvedValue([]);

      await service.cancelOrder(
        'o-1',
        'u-1',
        'Quá hạn thanh toán 15 phút',
        true,
        paymentTxMock,
      );

      expect(repository.updateStatusWithHistory).toHaveBeenCalledWith(
        'o-1',
        OrderStatus.PENDING,
        OrderStatus.CANCELLED,
        'u-1',
        'Quá hạn thanh toán 15 phút',
        paymentTxMock,
      );
      expect(promotionsServiceMock.releaseRedemption).toHaveBeenCalledWith(
        paymentTxMock,
        'o-1',
        true,
      );
    });

    it('cancelOrder (Khách hủy đơn) - tự tạo transaction và release coupon RELEASED', async () => {
      // Khách chủ động hủy đơn còn hạn; mọi thao tác trong callback dùng transaction mock do Prisma truyền vào.
      repository.findByIdAndUserIdForUpdate.mockResolvedValue({
        id: 'o-1',
        userId: 'u-1',
        status: OrderStatus.PENDING,
        reservationExpiresAt: new Date(Date.now() + 15 * 60 * 1000),
      });
      txMock.payment.findFirst.mockResolvedValue(null);
      txMock.inventoryReservation.findMany.mockResolvedValue([]);

      await service.cancelOrder(
        'o-1',
        'u-1',
        'Khách hàng đổi ý hủy đơn',
        false,
      );

      expect(prismaMock.$transaction).toHaveBeenCalledTimes(1);
      expect(repository.updateStatusWithHistory).toHaveBeenCalledWith(
        'o-1',
        OrderStatus.PENDING,
        OrderStatus.CANCELLED,
        'u-1',
        'Khách hàng đổi ý hủy đơn',
        txMock,
      );
      // PromotionsService phải nhận transaction client, không nhận PrismaService gốc.
      expect(promotionsServiceMock.releaseRedemption).toHaveBeenCalledWith(
        txMock,
        'o-1',
        false,
      );
    });
  });

  // ==========================================
  // CÁC BÀI TEST TẠO ĐƠN HÀNG (UC-06)
  // ==========================================
  describe('createOrder (UC-06)', () => {
    const mockDto = {
      items: [
        {
          productVariantId: 'variant-1',
          quantity: 2,
          toppingIds: ['topping-1'],
          sugarLevel: 100,
          iceLevel: 50,
          note: 'Ít ngọt',
        },
      ],
    };

    const mockOrderDb = {
      id: 'order-uuid-1',
      orderNumber: 'ORD-12345',
      status: OrderStatus.PENDING,
      subtotal: 86000n,
      discountAmount: 0n,
      total: 86000n,
      couponCodeSnapshot: null,
      reservationExpiresAt: new Date(),
      createdAt: new Date(),
      items: [
        {
          id: 'item-1',
          productNameSnapshot: 'Cà phê sữa',
          variantNameSnapshot: 'M',
          unitPrice: 35000n,
          quantity: 2,
          sugarLevel: 100,
          iceLevel: 50,
          note: 'Ít ngọt',
          orderItemToppings: [
            {
              id: 'item-top-1',
              toppingNameSnapshot: 'Trân châu',
              unitPrice: 8000n,
              quantity: 1,
            },
          ],
        },
      ],
    };

    it('tạo đơn hàng thành công không có coupon: trừ tồn kho, tạo reservation, ghi history và trả về đúng DTO', async () => {
      txMock.order.create.mockResolvedValue(mockOrderDb);
      txMock.ingredient.updateMany.mockResolvedValue({ count: 1 });

      const result = await service.createOrder('u-1', mockDto as any);

      expect(txMock.order.create).toHaveBeenCalled();
      // 2 ly x 10g = 20g nguyên liệu bị trừ; không có tồn kho thành phẩm.
      expect(txMock.ingredient.updateMany).toHaveBeenCalledWith({
        where: {
          id: 'ingredient-1',
          version: 0,
          isActive: true,
          stockQuantity: { gte: 20 },
        },
        data: {
          stockQuantity: { decrement: 20 },
          version: { increment: 1 },
        },
      });

      expect(txMock.inventoryReservation.create).toHaveBeenCalledWith({
        data: {
          orderId: 'order-uuid-1',
          productVariantId: 'variant-1',
          quantity: 2,
          status: 'ACTIVE',
          expiresAt: expect.any(Date),
          // Nguyên liệu của ly (2 x 10g) và của topping (2 phần x 30g).
          items: {
            create: [
              { ingredientId: 'ingredient-1', quantity: 20 },
              { ingredientId: 'pearl', quantity: 60 },
            ],
          },
        },
      });

      expect(txMock.orderStatusHistory.create).toHaveBeenCalledWith({
        data: {
          orderId: 'order-uuid-1',
          fromStatus: null,
          toStatus: OrderStatus.PENDING,
          changedByUserId: 'u-1',
          reason: 'Khách hàng tạo đơn hàng',
        },
      });

      expect(result.id).toBe('order-uuid-1');
      expect(result.status).toBe('PENDING');
      expect(result.subtotal).toBe(86000);
      expect(result.total).toBe(86000);
      expect(result.discountAmount).toBe(0);
      expect(result.items).toHaveLength(1);
    });

    it('tạo đơn hàng thành công có coupon: gọi quoteAndLock và reserve', async () => {
      // Chuẩn bị DTO đầu vào có đính kèm mã giảm giá SALE10
      const dtoWithCoupon = {
        ...mockDto,
        couponCode: 'SALE10',
      };

      // Snapshot đơn hàng trả về từ DB sau khi đã trừ giảm giá (86.000 - 10.000 = 76.000 VND)
      const mockOrderWithCoupon = {
        ...mockOrderDb,
        discountAmount: 10000n,
        total: 76000n,
        couponCodeSnapshot: 'SALE10',
      };

      txMock.order.create.mockResolvedValue(mockOrderWithCoupon);
      txMock.ingredient.updateMany.mockResolvedValue({ count: 1 });
      promotionsServiceMock.quoteAndLock.mockResolvedValue({
        couponId: 'c-1',
        discountAmount: 10000n,
      });

      const result = await service.createOrder('u-1', dtoWithCoupon as any);

      // 1. Kiểm chứng gọi quoteAndLock với đúng transaction txMock, userId, mã coupon và subtotal
      expect(promotionsServiceMock.quoteAndLock).toHaveBeenCalledWith(
        txMock,
        'u-1',
        'SALE10',
        86000n,
        expect.any(Date),
      );

      // 2. Kiểm chứng gọi reserve sau khi đã có orderId ('order-uuid-1') để không vi phạm FK order_id (SD-12)
      expect(promotionsServiceMock.reserve).toHaveBeenCalledWith(
        txMock,
        expect.objectContaining({ couponId: 'c-1' }),
        'order-uuid-1',
        expect.any(Date),
      );

      // 3. Kiểm chứng DTO trả về phản ánh đúng số tiền giảm và tổng thanh toán cuối cùng
      expect(result.discountAmount).toBe(10000);
      expect(result.total).toBe(76000);
    });

    it('sử dụng đúng ORDER_RESERVATION_TTL_MINUTES cấu hình và đồng bộ cùng một thời điểm hết hạn cho order, inventory và coupon', async () => {
      const prevTtl = process.env.ORDER_RESERVATION_TTL_MINUTES;
      try {
        process.env.ORDER_RESERVATION_TTL_MINUTES = '25';
        const dtoWithCoupon = {
          ...mockDto,
          couponCode: 'SALE10',
        };
        let capturedOrderExpiresAt: Date | null = null;
        txMock.order.create.mockImplementation(async ({ data }: any) => {
          capturedOrderExpiresAt = data.reservationExpiresAt;
          return {
            ...mockOrderDb,
            discountAmount: 10000n,
            total: 76000n,
            couponCodeSnapshot: 'SALE10',
            reservationExpiresAt: data.reservationExpiresAt,
          };
        });
        txMock.ingredient.updateMany.mockResolvedValue({ count: 1 });
        let capturedQuoteNow: Date | null = null;
        promotionsServiceMock.quoteAndLock.mockImplementation(
          async (_tx: any, _userId: string, _code: string, _subtotal: bigint, now: Date) => {
            capturedQuoteNow = now;
            return {
              couponId: 'c-1',
              discountAmount: 10000n,
            };
          },
        );

        const configuredService = new OrdersService(
          repository as unknown as OrdersRepository,
          prismaMock as unknown as PrismaService,
          promotionsServiceMock as unknown as PromotionsService,
          new CatalogService({} as any),
          new InventoryService(
            prismaMock as PrismaService,
            new InventoryRepository({} as never),
          ),
          new UsersService(),
        );
        await configuredService.createOrder('u-1', dtoWithCoupon as any);

        expect(capturedOrderExpiresAt).toBeInstanceOf(Date);
        expect(capturedQuoteNow).toBeInstanceOf(Date);
        expect(capturedOrderExpiresAt!.getTime() - capturedQuoteNow!.getTime()).toBe(
          25 * 60 * 1000,
        );
        expect(txMock.inventoryReservation.create).toHaveBeenCalledWith(
          expect.objectContaining({
            data: expect.objectContaining({
              expiresAt: capturedOrderExpiresAt,
            }),
          }),
        );
        expect(promotionsServiceMock.reserve).toHaveBeenCalledWith(
          txMock,
          expect.objectContaining({ couponId: 'c-1' }),
          'order-uuid-1',
          capturedOrderExpiresAt,
        );
      } finally {
        if (prevTtl === undefined) delete process.env.ORDER_RESERVATION_TTL_MINUTES;
        else process.env.ORDER_RESERVATION_TTL_MINUTES = prevTtl;
      }
    });

    it('ném ConflictException nếu updateMany nguyên liệu trả về count = 0 (hết nguyên liệu trong transaction)', async () => {
      txMock.order.create.mockResolvedValue(mockOrderDb);
      txMock.ingredient.updateMany.mockResolvedValue({ count: 0 });

      await expect(service.createOrder('u-1', mockDto as any)).rejects.toThrow(
        ConflictException,
      );
    });
  });

  // ==========================================
  // CÁC BÀI TEST LẤY LỊCH SỬ ĐƠN HÀNG (GET /orders/me)
  // ==========================================
  describe('getMyOrders', () => {
    it('lấy danh sách đơn hàng của user, sắp xếp mới nhất và map đúng DTO', async () => {
      const mockDbOrders = [
        {
          id: 'order-1',
          orderNumber: 'ORD-001',
          userId: 'u-1',
          status: OrderStatus.PENDING,
          subtotal: 50000n,
          discountAmount: 0n,
          total: 50000n,
          couponCodeSnapshot: null,
          reservationExpiresAt: new Date('2026-10-23T10:15:00Z'),
          createdAt: new Date('2026-10-23T10:00:00Z'),
          items: [
            {
              id: 'item-1',
              productNameSnapshot: 'Trà sen',
              variantNameSnapshot: 'L',
              unitPrice: 40000n,
              quantity: 1,
              sugarLevel: 100,
              iceLevel: 100,
              note: null,
              orderItemToppings: [
                {
                  id: 'top-1',
                  toppingNameSnapshot: 'Hạt sen',
                  unitPrice: 10000n,
                  quantity: 1,
                },
              ],
            },
          ],
        },
      ];

      repository.findOrdersByUserId.mockResolvedValue(mockDbOrders);

      const result = await service.getMyOrders('u-1');

      expect(repository.findOrdersByUserId).toHaveBeenCalledWith('u-1');
      expect(result).toHaveLength(1);

      expect(result[0]).toEqual({
        id: 'order-1',
        orderNumber: 'ORD-001',
        status: OrderStatus.PENDING,
        items: [
          {
            id: 'item-1',
            productName: 'Trà sen',
            size: 'L',
            unitPrice: 40000,
            quantity: 1,
            sugarLevel: 100,
            iceLevel: 100,
            note: null,
            toppings: [
              {
                name: 'Hạt sen',
                unitPrice: 10000,
                quantity: 1,
              },
            ],
            lineTotal: 50000,
          },
        ],
        subtotal: 50000,
        discountAmount: 0,
        total: 50000,
        currency: 'VND',
        reservationExpiresAt: '2026-10-23T10:15:00.000Z',
        createdAt: '2026-10-23T10:00:00.000Z',
      });
    });

    it('trả về mảng rỗng nếu user chưa có đơn hàng nào', async () => {
      repository.findOrdersByUserId.mockResolvedValue([]);

      const result = await service.getMyOrders('u-new');

      expect(repository.findOrdersByUserId).toHaveBeenCalledWith('u-new');
      expect(result).toEqual([]);
    });
  });

  // ==========================================
  // CÁC BÀI TEST CHI TIẾT ĐƠN HÀNG (GET /orders/:id)
  // ==========================================
  describe('getOrderDetail', () => {
    it('trả về 404 NotFoundException nếu đơn hàng không tồn tại hoặc không phải chủ đơn', async () => {
      repository.findOrderDetail.mockResolvedValue(null);

      await expect(
        service.getOrderDetail('o-khong-ton-tai', 'u-1'),
      ).rejects.toThrow(NotFoundException);

      expect(repository.findOrderDetail).toHaveBeenCalledWith(
        'o-khong-ton-tai',
        'u-1',
      );
    });

    it('trả về chi tiết đơn hàng đầy đủ kèm payment summary và timeline đúng thứ tự', async () => {
      const mockDetailDb = {
        id: 'order-1',
        orderNumber: 'ORD-001',
        userId: 'u-1',
        status: OrderStatus.PAID,
        subtotal: 50000n,
        discountAmount: 5000n,
        total: 45000n,
        couponCodeSnapshot: 'DISC5',
        reservationExpiresAt: new Date('2026-10-23T10:15:00Z'),
        createdAt: new Date('2026-10-23T10:00:00Z'),

        items: [
          {
            id: 'item-1',
            productNameSnapshot: 'Cà phê đen',
            variantNameSnapshot: 'M',
            unitPrice: 30000n,
            quantity: 1,
            sugarLevel: 100,
            iceLevel: 100,
            note: null,
            orderItemToppings: [],
          },
        ],

        payments: [
          {
            id: 'pay-1',
            method: 'CASH',
            status: 'SUCCEEDED',
            amount: 45000n,
            gatewayTransactionId: 'gw-123',
            processedAt: new Date('2026-10-23T10:05:00Z'),
            createdAt: new Date('2026-10-23T10:02:00Z'),
          },
        ],

        statusHistories: [
          {
            id: 'hist-1',
            fromStatus: null,
            toStatus: OrderStatus.PENDING,
            reason: 'Khởi tạo',
            createdAt: new Date('2026-10-23T10:00:00Z'),
          },
          {
            id: 'hist-2',
            fromStatus: OrderStatus.PENDING,
            toStatus: OrderStatus.PAID,
            reason: 'Thanh toán thành công',
            createdAt: new Date('2026-10-23T10:05:00Z'),
          },
        ],
      };

      repository.findOrderDetail.mockResolvedValue(mockDetailDb);

      const result = await service.getOrderDetail('order-1', 'u-1');

      expect(repository.findOrderDetail).toHaveBeenCalledWith('order-1', 'u-1');
      expect(result.id).toBe('order-1');

      expect(result.paymentSummary).toEqual({
        id: 'pay-1',
        method: 'CASH',
        status: 'SUCCEEDED',
        amount: 45000,
        gatewayTransactionId: 'gw-123',
        processedAt: '2026-10-23T10:05:00.000Z',
        createdAt: '2026-10-23T10:02:00.000Z',
      });

      expect(result.timeline).toHaveLength(2);
      expect(result.timeline[0].toStatus).toBe(OrderStatus.PENDING);
      expect(result.timeline[1].toStatus).toBe(OrderStatus.PAID);
    });
  });
});
