// Kiểm tra đăng ký, xác thực và hồ sơ của AuthService.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ConflictException, UnauthorizedException } from '@nestjs/common';
import { AuthService } from '../../src/modules/auth/auth.service.js';
import type { UserRepository } from '../../src/modules/auth/repositories/user.repository.js';

// Mock bcryptjs to avoid slow real hashing in unit tests
// Mock bcryptjs to avoid slow real hashing in unit tests
vi.mock('bcryptjs', () => {
  const hash = async (_pw: string, _r: number) => '$2b$10$mockhash';
  const compare = async (pw: string, hash: string) => hash === '$2b$10$mockhash' && pw === 'correct-password';
  return { default: { hash, compare }, hash, compare };
});

const baseUser = {
  id: 'user-uuid',
  username: 'testuser',
  passwordHash: '$2b$10$mockhash',
  role: 'CUSTOMER' as const,
  loyaltyBalance: 0,
  isActive: true,
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
  updatedAt: new Date('2026-01-01T00:00:00.000Z'),
};

function makeService() {
  const users = {
    findByUsername: vi.fn<UserRepository['findByUsername']>(),
    findById: vi.fn<UserRepository['findById']>(),
    create: vi.fn<UserRepository['create']>(),
  };
  const auth = new AuthService(users as unknown as UserRepository, {
    jwtSecret: 'unit-test-secret-abc12345678901234567890', jwtIssuer: 'brewlite-api', jwtAudience: 'brewlite-web',
    jwtExpiresInSeconds: 900, bcryptRounds: 10,
  } as never);
  return { auth, users };
}

beforeEach(() => {
  process.env.JWT_SECRET = 'test-secret-not-real';
  process.env.JWT_EXPIRES_IN = '900';
});

describe('AuthService.register', () => {
  it('creates a CUSTOMER account and never returns password', async () => {
    const { auth, users } = makeService();
    users.findByUsername.mockResolvedValue(null);
    users.create.mockResolvedValue({ ...baseUser, id: 'u1', username: 'alice', role: 'CUSTOMER', loyaltyBalance: 0, isActive: true });
    const result = await auth.register('alice', 'password123');
    expect(result).toMatchObject({ id: 'u1', username: 'alice', role: 'CUSTOMER' });
    expect(result).not.toHaveProperty('passwordHash');
    expect(result).not.toHaveProperty('password');
  });

  it('always creates CUSTOMER regardless of any attempted role injection', async () => {
    const { auth, users } = makeService();
    users.findByUsername.mockResolvedValue(null);
    users.create.mockResolvedValue({ ...baseUser, id: 'u2', username: 'bob', role: 'CUSTOMER', loyaltyBalance: 0, isActive: true });
    const result = await auth.register('bob', 'pw');
    expect(result.role).toBe('CUSTOMER');
  });

  it('rejects duplicate usernames with 409', async () => {
    const { auth, users } = makeService();
    users.findByUsername.mockResolvedValue(baseUser);
    await expect(auth.register('testuser', 'pw')).rejects.toBeInstanceOf(ConflictException);
  });
});

describe('AuthService.login', () => {
  it('returns an accessToken for valid credentials', async () => {
    const { auth, users } = makeService();
    users.findByUsername.mockResolvedValue(baseUser);
    const result = await auth.login('testuser', 'correct-password');
    expect(result).toHaveProperty('accessToken');
    expect(typeof result.accessToken).toBe('string');
    expect(result.accessToken.split('.').length).toBe(3);
  });

  it('rejects wrong password with same 401 as unknown user (no enumeration)', async () => {
    const { auth, users } = makeService();
    users.findByUsername.mockResolvedValue(baseUser);
    await expect(auth.login('testuser', 'wrong-password')).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('rejects unknown username with same 401 (no enumeration)', async () => {
    const { auth, users } = makeService();
    users.findByUsername.mockResolvedValue(null);
    await expect(auth.login('ghost', 'any')).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('rejects inactive accounts', async () => {
    const { auth, users } = makeService();
    users.findByUsername.mockResolvedValue({ ...baseUser, isActive: false });
    await expect(auth.login('testuser', 'correct-password')).rejects.toBeInstanceOf(UnauthorizedException);
  });
});

describe('AuthService.getMe', () => {
  it('returns profile without sensitive fields', async () => {
    const { auth, users } = makeService();
    users.findById.mockResolvedValue({ ...baseUser, id: 'u1', username: 'alice', role: 'CUSTOMER', loyaltyBalance: 42, isActive: true });
    const profile = await auth.getMe('u1');
    expect(profile).toMatchObject({ id: 'u1', username: 'alice', role: 'CUSTOMER', loyaltyBalance: 42 });
    expect(profile).not.toHaveProperty('passwordHash');
  });

  it('throws 401 when user not found', async () => {
    const { auth, users } = makeService();
    users.findById.mockResolvedValue(null);
    await expect(auth.getMe('missing')).rejects.toBeInstanceOf(UnauthorizedException);
  });
});
