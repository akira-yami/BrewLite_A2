// Kiểm tra cấu hình bắt buộc, JWT và URL database khi khởi động.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadConfig } from '../../src/config/app-config.js';

afterEach(() => vi.unstubAllEnvs());

function validEnv() {
  vi.stubEnv('NODE_ENV', 'test');
  vi.stubEnv('DATABASE_URL', 'postgresql://user:password@localhost:5432/brewlite');
  vi.stubEnv('JWT_SECRET', 'a-valid-test-secret-that-is-at-least-32-bytes');
  vi.stubEnv('JWT_ISSUER', 'brewlite-api');
  vi.stubEnv('JWT_AUDIENCE', 'brewlite-web');
}

describe('loadConfig', () => {
  it('validates required config and returns safe runtime settings', () => {
    validEnv();
    expect(loadConfig()).toMatchObject({
      nodeEnv: 'test', port: 3001, jwtExpiresInSeconds: 900,
      bcryptRounds: 10, corsOrigins: ['http://localhost:3000'],
    });
  });

  it('rejects weak JWT secrets before startup', () => {
    validEnv();
    vi.stubEnv('JWT_SECRET', 'too-short');
    expect(() => loadConfig()).toThrow(/at least 32 bytes/);
  });

  it('rejects non-PostgreSQL URLs and non-mock payment providers', () => {
    validEnv();
    vi.stubEnv('DATABASE_URL', 'https://example.com');
    expect(() => loadConfig()).toThrow(/PostgreSQL/);
    vi.stubEnv('DATABASE_URL', 'postgresql://user:password@localhost:5432/brewlite');
    vi.stubEnv('PAYMENT_PROVIDER', 'live');
    expect(() => loadConfig()).toThrow(/mock/);
  });
});
