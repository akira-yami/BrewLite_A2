// Kiểm tra các kết quả và cơ chế phát lại của cổng thanh toán giả lập.
/**
 * Unit tests – Mock Payment Gateway
 *
 * Issue: A2-5.2.1.2 / #31
 * Phụ trách: Kiệt · Sprint 2
 *
 * Phạm vi bao phủ (SRS FR-07, AT-FR-07.5, ADR-004):
 *   TC-GW-01  Outcome SUCCESS: trả GatewayResponse { result: 'SUCCESS', transactionId: string }
 *   TC-GW-02  Outcome DECLINE: trả GatewayResponse { result: 'DECLINE', transactionId: null }
 *   TC-GW-03  Outcome TIMEOUT: ném Error('GATEWAY_TIMEOUT'), không lưu kết quả
 *   TC-GW-04  Idempotency: cùng key gọi lần hai trả cùng kết quả đã lưu, không charge lại
 *   TC-GW-05  DECLINE cùng key: trả lại DECLINE, không đổi thành SUCCESS lần sau
 *   TC-GW-06  Nhiều key độc lập: kết quả của key A không ảnh hưởng key B
 *   TC-GW-07  lookupResult: trả kết quả nếu đã có, null nếu chưa
 *   TC-GW-08  transactionId của SUCCESS bắt đầu bằng 'TXN-'
 *   TC-GW-09  Sau TIMEOUT, key đó không được lưu → lookup trả null
 *   TC-GW-10  __clearForTests: xóa toàn bộ trạng thái nội bộ
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  chargeOnce,
  lookupResult,
  __clearForTests,
} from '../../src/modules/payments/mock-gateway.js';

beforeEach(() => {
  __clearForTests();
  delete process.env.MOCK_PAYMENT_OUTCOME;
});

describe('Mock Gateway — chargeOnce', () => {
  // TC-GW-01
  it('TC-GW-01: SUCCESS → trả { result: SUCCESS, transactionId: string }', async () => {
    process.env.MOCK_PAYMENT_OUTCOME = 'SUCCESS';
    const result = await chargeOnce('key-001', 50000n);

    expect(result.result).toBe('SUCCESS');
    expect(typeof result.transactionId).toBe('string');
    expect(result.transactionId).not.toBeNull();
  });

  // TC-GW-02
  it('TC-GW-02: DECLINE → trả { result: DECLINE, transactionId: null }', async () => {
    process.env.MOCK_PAYMENT_OUTCOME = 'DECLINE';
    const result = await chargeOnce('key-002', 50000n);

    expect(result.result).toBe('DECLINE');
    expect(result.transactionId).toBeNull();
  });

  // TC-GW-03
  it('TC-GW-03: TIMEOUT → ném Error("GATEWAY_TIMEOUT"), không lưu kết quả', async () => {
    process.env.MOCK_PAYMENT_OUTCOME = 'TIMEOUT';

    await expect(chargeOnce('key-003', 50000n))
      .rejects.toThrow('GATEWAY_TIMEOUT');
  });

  // TC-GW-04
  it('TC-GW-04: cùng key gọi lần hai trả cùng kết quả (idempotent re-delivery)', async () => {
    process.env.MOCK_PAYMENT_OUTCOME = 'SUCCESS';
    const first = await chargeOnce('key-idem-001', 50000n);

    // Đổi env để chắc lần hai không đổi kết quả
    process.env.MOCK_PAYMENT_OUTCOME = 'DECLINE';
    const second = await chargeOnce('key-idem-001', 50000n);

    expect(second.result).toBe('SUCCESS');
    expect(second.transactionId).toBe(first.transactionId);
  });

  // TC-GW-05
  it('TC-GW-05: DECLINE cùng key trả lại DECLINE trên lần gọi thứ hai', async () => {
    process.env.MOCK_PAYMENT_OUTCOME = 'DECLINE';
    await chargeOnce('key-decline-001', 50000n);

    process.env.MOCK_PAYMENT_OUTCOME = 'SUCCESS';
    const second = await chargeOnce('key-decline-001', 50000n);

    expect(second.result).toBe('DECLINE');
  });

  // TC-GW-06
  it('TC-GW-06: key khác nhau có kết quả độc lập', async () => {
    process.env.MOCK_PAYMENT_OUTCOME = 'SUCCESS';
    const r1 = await chargeOnce('key-A', 50000n);

    process.env.MOCK_PAYMENT_OUTCOME = 'DECLINE';
    const r2 = await chargeOnce('key-B', 50000n);

    expect(r1.result).toBe('SUCCESS');
    expect(r2.result).toBe('DECLINE');
    expect(r1.transactionId).not.toBe(r2.transactionId);
  });

  // TC-GW-08
  it('TC-GW-08: transactionId của SUCCESS bắt đầu bằng "TXN-"', async () => {
    process.env.MOCK_PAYMENT_OUTCOME = 'SUCCESS';
    const result = await chargeOnce('key-txn-001', 100000n);

    expect(result.transactionId).toMatch(/^TXN-/);
  });

  // TC-GW-09
  it('TC-GW-09: sau TIMEOUT, key đó không được lưu → lookup trả null', async () => {
    process.env.MOCK_PAYMENT_OUTCOME = 'TIMEOUT';
    await expect(chargeOnce('key-timeout-001', 50000n)).rejects.toThrow('GATEWAY_TIMEOUT');

    const lookup = await lookupResult('key-timeout-001');
    expect(lookup).toBeNull();
  });
});

describe('Mock Gateway — lookupResult', () => {
  // TC-GW-07a
  it('TC-GW-07a: trả null khi key chưa có kết quả', async () => {
    const result = await lookupResult('key-never-charged');
    expect(result).toBeNull();
  });

  // TC-GW-07b
  it('TC-GW-07b: trả kết quả đúng sau khi SUCCESS được charge', async () => {
    process.env.MOCK_PAYMENT_OUTCOME = 'SUCCESS';
    const charged = await chargeOnce('key-lookup-001', 50000n);

    const looked = await lookupResult('key-lookup-001');
    expect(looked).not.toBeNull();
    expect(looked!.result).toBe('SUCCESS');
    expect(looked!.transactionId).toBe(charged.transactionId);
  });

  // TC-GW-07c
  it('TC-GW-07c: trả kết quả DECLINE sau khi DECLINE được charge', async () => {
    process.env.MOCK_PAYMENT_OUTCOME = 'DECLINE';
    await chargeOnce('key-lookup-decline', 50000n);

    const looked = await lookupResult('key-lookup-decline');
    expect(looked).not.toBeNull();
    expect(looked!.result).toBe('DECLINE');
  });
});

describe('Mock Gateway — __clearForTests', () => {
  // TC-GW-10
  it('TC-GW-10: __clearForTests xóa toàn bộ trạng thái — lookup sau clear trả null', async () => {
    process.env.MOCK_PAYMENT_OUTCOME = 'SUCCESS';
    await chargeOnce('key-to-clear', 50000n);

    // Confirm it's stored
    const beforeClear = await lookupResult('key-to-clear');
    expect(beforeClear).not.toBeNull();

    __clearForTests();

    // After clear, gone
    const afterClear = await lookupResult('key-to-clear');
    expect(afterClear).toBeNull();
  });
});
