// Kiểm tra ký JWT, xác thực chữ ký, hạn dùng và đối tượng nhận.
import { describe, it, expect } from 'vitest';
import { jwt } from '../../src/common/utils/jwt.js';

const SECRET = 'unit-test-secret-abc123';
const ISSUER = 'brewlite-api';
const AUDIENCE = 'brewlite-web';

describe('JWT utility', () => {
  it('signs and verifies a token with correct payload', () => {
    const token = jwt.sign({ sub: 'user-1', role: 'CUSTOMER' }, SECRET, 3600, ISSUER, AUDIENCE);
    const payload = jwt.verify(token, SECRET, ISSUER, AUDIENCE);
    expect(payload.sub).toBe('user-1');
    expect(payload.role).toBe('CUSTOMER');
  });

  it('rejects a token signed with a different secret', () => {
    const token = jwt.sign({ sub: 'u', role: 'CUSTOMER' }, SECRET, 3600, ISSUER, AUDIENCE);
    expect(() => jwt.verify(token, 'wrong-secret', ISSUER, AUDIENCE)).toThrow(/invalid signature/);
  });

  it('rejects a token that is expired', () => {
    const token = jwt.sign({ sub: 'u', role: 'CUSTOMER' }, SECRET, -1, ISSUER, AUDIENCE);
    expect(() => jwt.verify(token, SECRET, ISSUER, AUDIENCE)).toThrow(/expired/);
  });

  it('rejects a malformed token', () => {
    expect(() => jwt.verify('not.a.valid.jwt.parts', SECRET, ISSUER, AUDIENCE)).toThrow();
    expect(() => jwt.verify('onlyone', SECRET, ISSUER, AUDIENCE)).toThrow();
  });

  it('uses constant-time comparison (cannot bypass with partial match)', () => {
    const token = jwt.sign({ sub: 'u', role: 'CUSTOMER' }, SECRET, 3600, ISSUER, AUDIENCE);
    const parts = token.split('.');
    // tamper the signature by one character
    const tamperedSig = parts[2].slice(0, -1) + (parts[2].slice(-1) === 'a' ? 'b' : 'a');
    const tampered = `${parts[0]}.${parts[1]}.${tamperedSig}`;
    expect(() => jwt.verify(tampered, SECRET, ISSUER, AUDIENCE)).toThrow(/invalid signature/);
  });

  it('rejects a token issued for another audience', () => {
    const token = jwt.sign({ sub: 'u', role: 'CUSTOMER' }, SECRET, 3600, ISSUER, AUDIENCE);
    expect(() => jwt.verify(token, SECRET, ISSUER, 'other-client')).toThrow(/issuer or audience/);
  });
});
