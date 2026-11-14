// Kiểm tra bảng chuyển trạng thái đơn và từ chối các bước chuyển sai.
import { describe, it, expect } from 'vitest';
import { canTransition } from '../../src/modules/orders/order-state.js';
import type { OrderStatus } from '../../src/generated/prisma/client.js';

const allStatuses: OrderStatus[] = [
  'PENDING', 'PAYMENT_FAILED', 'PAID', 'PREPARING', 'READY', 'COMPLETED', 'CANCELLED',
];

// SRS FR-09 transition table
const validTransitions: [OrderStatus, OrderStatus][] = [
  ['PENDING', 'PAID'],
  ['PENDING', 'PAYMENT_FAILED'],
  ['PENDING', 'CANCELLED'],
  ['PAYMENT_FAILED', 'PENDING'],
  ['PAYMENT_FAILED', 'CANCELLED'],
  ['PAID', 'CANCELLED'],
  ['PAID', 'PREPARING'],
  ['PREPARING', 'READY'],
  ['READY', 'COMPLETED'],
];

describe('Order state machine', () => {
  it.each(validTransitions)('%s -> %s is allowed', (from, to) => {
    expect(canTransition(from, to)).toBe(true);
  });

  it('rejects transitions from final states (COMPLETED, CANCELLED)', () => {
    for (const to of allStatuses) {
      expect(canTransition('COMPLETED', to)).toBe(false);
      expect(canTransition('CANCELLED', to)).toBe(false);
    }
  });

  it('rejects self-transitions (same state)', () => {
    for (const s of allStatuses) {
      expect(canTransition(s, s)).toBe(false);
    }
  });

  it('rejects skipping states (PENDING -> PREPARING)', () => {
    expect(canTransition('PENDING', 'PREPARING')).toBe(false);
    expect(canTransition('PENDING', 'READY')).toBe(false);
    expect(canTransition('PENDING', 'COMPLETED')).toBe(false);
    expect(canTransition('PAID', 'READY')).toBe(false);
    expect(canTransition('PAID', 'COMPLETED')).toBe(false);
  });

  it('rejects backward transitions', () => {
    expect(canTransition('PREPARING', 'PAID')).toBe(false);
    expect(canTransition('READY', 'PREPARING')).toBe(false);
    expect(canTransition('COMPLETED', 'READY')).toBe(false);
  });

  it('table is complete: all valid transitions are exactly the defined set', () => {
    const found: string[] = [];
    for (const from of allStatuses) {
      for (const to of allStatuses) {
        if (canTransition(from, to)) found.push(`${from}->${to}`);
      }
    }
    const expected = validTransitions.map(([f, t]) => `${f}->${t}`);
    expect(found.sort()).toEqual(expected.sort());
  });
});
