// Kiểm tra dữ liệu và cấu hình khởi tạo cho test VNPay.
import { test, expect } from './vnpay-fixtures.js';

/**
 * Smoke test to verify fixtures are properly initialized
 * This test validates that all fixtures inject correctly and contain expected values
 */
test('Khởi tạo dữ liệu test VNPay', async ({ vnpayHelper, testUser, apiUrl }) => {
  // Verify apiUrl fixture
  expect(apiUrl).toBeTruthy();
  expect(typeof apiUrl).toBe('string');

  // Verify vnpayHelper fixture
  expect(vnpayHelper).toBeDefined();
  expect(typeof vnpayHelper.computeSignature).toBe('function');
  expect(typeof vnpayHelper.simulateIpn).toBe('function');
  expect(typeof vnpayHelper.verifyPaymentUrl).toBe('function');

  // Verify testUser fixture
  expect(testUser).toBeDefined();
  expect(testUser.username).toBeTruthy();
  expect(testUser.password).toBeTruthy();
  expect(testUser.accessToken).toBeTruthy();
  expect(testUser.userId).toBeTruthy();
});
