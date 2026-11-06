import { ConflictException } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PrismaService } from '../../../database/prisma.service.js';
import type { Prisma } from '../../../generated/prisma/client.js';
import { InventoryRepository } from '../repositories/inventory.repository.js';
import { InventoryService } from './inventory.service.js';

describe('InventoryService - reserve', () => {
  let service: InventoryService;

  const prisma = {
    $transaction: vi.fn(),
  };

  const repository = {
    findVariantWithRecipe: vi.fn(),
    reserveIngredient: vi.fn(),
    createReservation: vi.fn(),
    findReservation: vi.fn(),
    transitionActiveReservation: vi.fn(),
    restoreIngredient: vi.fn(),
  };

  // reserve() nhận transaction từ bên ngoài,
  // nên test này chỉ cần một đối tượng giả làm transaction.
  const tx = {} as Prisma.TransactionClient;

  // Công thức: mỗi ly dùng 10g cà phê; kho có `stockQuantity` gram.
  const variantWithRecipe = (stockQuantity: number) => ({
    id: 'variant-1',
    isActive: true,
    recipeItems: [
      {
        ingredientId: 'bean',
        quantity: 10,
        ingredient: {
          id: 'bean',
          stockQuantity,
          version: 0,
          isActive: true,
        },
      },
    ],
  });

  beforeEach(() => {
    vi.clearAllMocks();

    service = new InventoryService(
      prisma as unknown as PrismaService,
      repository as unknown as InventoryRepository,
    );
    prisma.$transaction.mockImplementation(async (callback) => callback(tx));

    repository.findReservation.mockResolvedValue({
      id: 'reservation-1',
      orderId: 'order-1',
      productVariantId: 'variant-1',
      quantity: 2,
      status: 'ACTIVE',
      expiresAt: new Date(Date.now() + 15 * 60 * 1000),
      items: [
        { ingredientId: 'bean', quantity: 20 },
        { ingredientId: 'cup', quantity: 2 },
      ],
    });

    repository.transitionActiveReservation.mockResolvedValue({ count: 1 });
    repository.restoreIngredient.mockResolvedValue({});

    repository.findVariantWithRecipe.mockResolvedValue(variantWithRecipe(50));

    repository.reserveIngredient.mockResolvedValue({ count: 1 });

    repository.createReservation.mockResolvedValue({
      id: 'reservation-1',
      orderId: 'order-1',
      productVariantId: 'variant-1',
      quantity: 2,
      status: 'ACTIVE',
    });
  });

  it('giữ nguyên liệu thành công khi tồn kho nguyên liệu đủ', async () => {
    const result = await service.reserve(
      tx,
      'order-1',
      [{ productVariantId: 'variant-1', quantity: 2 }],
      new Date(Date.now() + 15 * 60 * 1000),
    );

    // 2 ly x 10g = 20g cà phê.
    expect(repository.reserveIngredient).toHaveBeenCalledWith(
      tx,
      'bean',
      0,
      20,
    );

    expect(repository.createReservation).toHaveBeenCalledTimes(1);
    expect(repository.createReservation).toHaveBeenCalledWith(
      tx,
      'order-1',
      'variant-1',
      2,
      expect.any(Date),
      [{ ingredientId: 'bean', quantity: 20 }],
    );
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('reservation-1');
  });

  it('từ chối khi tồn kho nguyên liệu không đủ cho số ly yêu cầu', async () => {
    // Còn 15g, 2 ly cần 20g => chỉ làm được 1 ly.
    repository.findVariantWithRecipe.mockResolvedValue(variantWithRecipe(15));

    await expect(
      service.reserve(
        tx,
        'order-1',
        [{ productVariantId: 'variant-1', quantity: 2 }],
        new Date(Date.now() + 15 * 60 * 1000),
      ),
    ).rejects.toThrow(ConflictException);

    expect(repository.reserveIngredient).not.toHaveBeenCalled();
    expect(repository.createReservation).not.toHaveBeenCalled();
  });

  it('từ chối variant chưa có công thức', async () => {
    repository.findVariantWithRecipe.mockResolvedValue({
      id: 'variant-1',
      isActive: true,
      recipeItems: [],
    });

    await expect(
      service.reserve(
        tx,
        'order-1',
        [{ productVariantId: 'variant-1', quantity: 1 }],
        new Date(Date.now() + 15 * 60 * 1000),
      ),
    ).rejects.toThrow(ConflictException);

    expect(repository.reserveIngredient).not.toHaveBeenCalled();
  });

  it('consume chỉ chuyển trạng thái, không hoàn nguyên liệu', async () => {
    const result = await service.consume('reservation-1');

    expect(repository.transitionActiveReservation).toHaveBeenCalledWith(
      tx,
      'reservation-1',
      'CONSUMED',
      'NOT_EXPIRED',
    );

    expect(repository.restoreIngredient).not.toHaveBeenCalled();
    expect(result.status).toBe('CONSUMED');
  });

  it('release hoàn đúng lượng nguyên liệu đã giữ', async () => {
    const result = await service.release('reservation-1');

    expect(result.status).toBe('RELEASED');
    expect(repository.restoreIngredient).toHaveBeenCalledTimes(2);
    expect(repository.restoreIngredient).toHaveBeenCalledWith(tx, 'bean', 20);
    expect(repository.restoreIngredient).toHaveBeenCalledWith(tx, 'cup', 2);
  });

  it('release không hoàn nguyên liệu nếu reservation đã bị xử lý trước', async () => {
    repository.transitionActiveReservation.mockResolvedValue({ count: 0 });

    await expect(service.release('reservation-1')).rejects.toThrow(
      ConflictException,
    );

    expect(repository.restoreIngredient).not.toHaveBeenCalled();
  });

  it('từ chối khi version nguyên liệu thay đổi do yêu cầu khác cập nhật trước', async () => {
    // updateMany trả count = 0 nghĩa là không cập nhật được
    // với version mà yêu cầu này đã đọc.
    repository.reserveIngredient.mockResolvedValue({ count: 0 });

    await expect(
      service.reserve(
        tx,
        'order-1',
        [{ productVariantId: 'variant-1', quantity: 2 }],
        new Date(Date.now() + 15 * 60 * 1000),
      ),
    ).rejects.toThrow(ConflictException);

    expect(repository.createReservation).not.toHaveBeenCalled();
  });
});
