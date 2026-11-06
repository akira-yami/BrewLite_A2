import { ConflictException } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import { OrderStatus } from '../../../generated/prisma/client.js';
import {
  BARISTA_TARGET_STATUSES,
  ORDER_TRANSITIONS,
  STAFF_QUEUE_STATUSES,
  assertTransition,
  canTransition,
} from './order-state-machine.js';

const ALL = Object.values(OrderStatus);

// Đúng 9 mũi tên của sơ đồ đề bài, mục 9.1.
const DIAGRAM_ARROWS = [
  ['PENDING', 'PAID'], // thanh toán OK
  ['PAID', 'PREPARING'], // barista nhận
  ['PREPARING', 'READY'], // pha xong
  ['READY', 'COMPLETED'], // giao khách
  ['PENDING', 'PAYMENT_FAILED'], // thanh toán lỗi
  ['PAYMENT_FAILED', 'PENDING'], // thử lại
  ['PENDING', 'CANCELLED'], // hủy
  ['PAYMENT_FAILED', 'CANCELLED'], // hủy
  ['PAID', 'CANCELLED'], // hủy
] as const;

describe('order state machine', () => {
  it('khai báo luật cho mọi trạng thái', () => {
    expect(Object.keys(ORDER_TRANSITIONS).sort()).toEqual([...ALL].sort());
  });

  it('bảng luật khớp đúng các mũi tên của sơ đồ đề bài, không thừa không thiếu', () => {
    const actual = Object.entries(ORDER_TRANSITIONS)
      .flatMap(([from, targets]) => targets.map((to) => `${from}>${to}`))
      .sort();
    const expected = DIAGRAM_ARROWS.map(([from, to]) => `${from}>${to}`).sort();
    expect(actual).toEqual(expected);
  });

  it.each(DIAGRAM_ARROWS)('cho phép %s → %s', (from, to) => {
    expect(canTransition(from, to)).toBe(true);
    expect(() => assertTransition(from, to)).not.toThrow();
  });

  it('chỉ chấp nhận các cặp trong sơ đồ trên toàn bộ ma trận trạng thái', () => {
    const allowed = new Set(DIAGRAM_ARROWS.map(([from, to]) => `${from}>${to}`));
    for (const from of ALL) {
      for (const to of ALL) {
        expect(canTransition(from, to)).toBe(allowed.has(`${from}>${to}`));
      }
    }
  });

  it.each([
    ['PAID', 'READY'],
    ['PAID', 'COMPLETED'],
    ['PAID', 'PENDING'],
    ['PREPARING', 'COMPLETED'],
    ['PREPARING', 'PREPARING'],
    ['PREPARING', 'PAID'],
    ['PREPARING', 'CANCELLED'],
    ['READY', 'PREPARING'],
    ['READY', 'CANCELLED'],
    ['COMPLETED', 'READY'],
    ['PENDING', 'PREPARING'],
    ['PENDING', 'PENDING'],
    ['PAYMENT_FAILED', 'PAID'],
    ['PAYMENT_FAILED', 'PREPARING'],
    ['CANCELLED', 'PREPARING'],
    ['CANCELLED', 'PENDING'],
  ] as const)('assertTransition ném 409 INVALID_ORDER_TRANSITION cho %s → %s', (from, to) => {
    expect(() => assertTransition(from, to)).toThrow(ConflictException);
    try {
      assertTransition(from, to);
    } catch (error) {
      expect((error as ConflictException).getResponse()).toMatchObject({
        error: {
          code: 'INVALID_ORDER_TRANSITION',
          details: [{ from, to }],
        },
      });
    }
  });

  it('COMPLETED và CANCELLED là trạng thái kết thúc', () => {
    expect(ORDER_TRANSITIONS.COMPLETED).toEqual([]);
    expect(ORDER_TRANSITIONS.CANCELLED).toEqual([]);
    for (const to of ALL) {
      expect(canTransition('COMPLETED', to)).toBe(false);
      expect(canTransition('CANCELLED', to)).toBe(false);
    }
  });

  it('barista chỉ đặt được PREPARING, READY, COMPLETED', () => {
    expect([...BARISTA_TARGET_STATUSES]).toEqual([
      'PREPARING',
      'READY',
      'COMPLETED',
    ]);
    expect([...STAFF_QUEUE_STATUSES]).toEqual(['PAID', 'PREPARING', 'READY']);
  });
});
