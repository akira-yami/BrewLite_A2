import {
  ConflictException,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { OrdersService } from './orders.service.js';

const BARISTA_ID = '11111111-1111-4111-8111-111111111111';
const ORDER_ID = '22222222-2222-4222-8222-222222222222';

function orderRow(status: string) {
  return {
    id: ORDER_ID,
    orderNumber: 'ORD-1',
    status,
    total: 45000n,
    createdAt: new Date('2026-11-04T01:00:00Z'),
    updatedAt: new Date('2026-11-04T01:05:00Z'),
    items: [
      {
        id: 'i-1',
        productNameSnapshot: 'Bạc xỉu',
        variantNameSnapshot: 'M',
        unitPrice: 35000n,
        quantity: 1,
        sugarLevel: 50,
        iceLevel: 100,
        note: 'ít đá',
        orderItemToppings: [
          {
            toppingNameSnapshot: 'Trân châu',
            unitPrice: 10000n,
            quantity: 1,
          },
        ],
      },
    ],
  };
}

describe('OrdersService - Barista (EXT-UC10)', () => {
  const tx = { marker: 'tx' };
  let repository: any;
  let users: any;
  let prisma: any;
  let service: OrdersService;

  beforeEach(() => {
    repository = {
      findStaffQueue: vi.fn(),
      lockById: vi.fn(),
      updateStatusWithHistory: vi.fn().mockResolvedValue(undefined),
      findStaffOrder: vi.fn(),
    };
    users = { assertActiveBarista: vi.fn().mockResolvedValue(undefined) };
    prisma = { $transaction: vi.fn(async (cb: any) => cb(tx)) };
    service = new OrdersService(
      repository,
      prisma,
      {} as any,
      {} as any,
      {} as any,
      users,
    );
  });

  describe('getStaffQueue', () => {
    it('mặc định lấy PAID, PREPARING, READY và không lộ dữ liệu tài khoản khách', async () => {
      repository.findStaffQueue.mockResolvedValue([orderRow('PAID')]);

      const result = await service.getStaffQueue({}, BARISTA_ID);

      expect(repository.findStaffQueue).toHaveBeenCalledWith(
        ['PAID', 'PREPARING', 'READY'],
        100,
      );
      expect(result.data).toHaveLength(1);
      expect(result.data[0]).toMatchObject({
        id: ORDER_ID,
        orderNumber: 'ORD-1',
        status: 'PAID',
        total: 45000,
        currency: 'VND',
      });
      expect(result.data[0].items[0]).toMatchObject({
        productName: 'Bạc xỉu',
        note: 'ít đá',
        lineTotal: 45000,
      });
      expect(result.data[0]).not.toHaveProperty('userId');
    });

    it('lọc theo một trạng thái và giới hạn số đơn', async () => {
      repository.findStaffQueue.mockResolvedValue([]);
      await service.getStaffQueue({ status: 'READY', limit: 5 }, BARISTA_ID);
      expect(repository.findStaffQueue).toHaveBeenCalledWith(['READY'], 5);
    });
  });

  describe('advanceOrderStatus', () => {
    it.each([
      ['PAID', 'PREPARING'],
      ['PREPARING', 'READY'],
      ['READY', 'COMPLETED'],
    ] as const)('chuyển %s → %s, ghi lịch sử với id barista', async (from, to) => {
      repository.lockById.mockResolvedValue(orderRow(from));
      repository.findStaffOrder.mockResolvedValue(orderRow(to));

      const result = await service.advanceOrderStatus(ORDER_ID, BARISTA_ID, to);

      expect(users.assertActiveBarista).toHaveBeenCalledWith(tx, BARISTA_ID);
      expect(repository.lockById).toHaveBeenCalledWith(ORDER_ID, tx);
      expect(repository.updateStatusWithHistory).toHaveBeenCalledWith(
        ORDER_ID,
        from,
        to,
        BARISTA_ID,
        expect.any(String),
        tx,
      );
      expect(result.status).toBe(to);
    });

    it.each([
      ['PAID', 'READY'],
      ['PAID', 'COMPLETED'],
      ['PREPARING', 'COMPLETED'],
      ['PREPARING', 'PREPARING'],
      ['READY', 'PREPARING'],
      ['COMPLETED', 'READY'],
      ['PENDING', 'PREPARING'],
      ['PAYMENT_FAILED', 'PREPARING'],
      ['CANCELLED', 'PREPARING'],
    ] as const)(
      'chặn %s → %s bằng 409 INVALID_ORDER_TRANSITION và không ghi gì',
      async (from, to) => {
        repository.lockById.mockResolvedValue(orderRow(from));

        const error = await service
          .advanceOrderStatus(ORDER_ID, BARISTA_ID, to)
          .catch((e) => e);

        expect(error).toBeInstanceOf(ConflictException);
        expect(error.getResponse().error).toMatchObject({
          code: 'INVALID_ORDER_TRANSITION',
          details: [{ from, to }],
        });
        expect(repository.updateStatusWithHistory).not.toHaveBeenCalled();
      },
    );

    it('trả 404 khi đơn không tồn tại', async () => {
      repository.lockById.mockResolvedValue(null);
      await expect(
        service.advanceOrderStatus(ORDER_ID, BARISTA_ID, 'PREPARING'),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(repository.updateStatusWithHistory).not.toHaveBeenCalled();
    });

    it('từ chối khi tài khoản không còn là BARISTA đang hoạt động, trước khi khóa đơn', async () => {
      users.assertActiveBarista.mockRejectedValue(new UnauthorizedException());
      await expect(
        service.advanceOrderStatus(ORDER_ID, BARISTA_ID, 'PREPARING'),
      ).rejects.toBeInstanceOf(UnauthorizedException);
      expect(repository.lockById).not.toHaveBeenCalled();
      expect(repository.updateStatusWithHistory).not.toHaveBeenCalled();
    });

    it('hai barista cùng nhận một đơn: người đến sau bị chặn', async () => {
      repository.lockById
        .mockResolvedValueOnce(orderRow('PAID'))
        .mockResolvedValueOnce(orderRow('PREPARING'));
      repository.findStaffOrder.mockResolvedValue(orderRow('PREPARING'));

      await service.advanceOrderStatus(ORDER_ID, BARISTA_ID, 'PREPARING');
      await expect(
        service.advanceOrderStatus(ORDER_ID, 'other-barista', 'PREPARING'),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(repository.updateStatusWithHistory).toHaveBeenCalledTimes(1);
    });
  });
});
