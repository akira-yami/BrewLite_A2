import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ConflictException, UnauthorizedException } from '@nestjs/common';
import { AuthService } from '../src/modules/auth/auth.service.js';
import type { UsersService } from '../src/modules/users/users.service.js';

// Mock bcryptjs định nghĩa bên trong callback để tránh lỗi hoisting của Vitest
vi.mock('bcryptjs', () => {
  const mockBcrypt = {
    hash: async (_pw: string, _r: number) => '$2b$10$mockhash',
    compare: async (pw: string, hash: string) => hash === '$2b$10$mockhash' && pw === 'correct-password',
  };

  return {
    default: mockBcrypt,
    ...mockBcrypt,
  };
});

const baseUser = {
  id: 'user-uuid',
  username: 'testuser',
  passwordHash: '$2b$10$mockhash',
  role: 'CUSTOMER' as const,
  loyaltyBalance: 0,
  isActive: true,
};

function makeService() {
  const users = {
    findByUsername: vi.fn<Parameters<UsersService['findByUsername']>, ReturnType<UsersService['findByUsername']>>(),
    findById: vi.fn<Parameters<UsersService['findById']>, ReturnType<UsersService['findById']>>(),
    create: vi.fn<Parameters<UsersService['create']>, ReturnType<UsersService['create']>>(),
  };
  const auth = new AuthService(users as unknown as any);
  return { auth, users };
}

beforeEach(() => {
  process.env.JWT_SECRET = 'test-secret-not-real';
  process.env.JWT_EXPIRES_IN = '900s';
});

describe('AuthService.register', () => {
  it('creates a CUSTOMER account and never returns password', async () => {
    const { auth, users } = makeService();
    users.findByUsername.mockResolvedValue(null);
    users.create.mockResolvedValue({ id: 'u1', username: 'alice', role: 'CUSTOMER', loyaltyBalance: 0, isActive: true });
    const result = await auth.register('alice', 'password123');
    expect(result).toMatchObject({ id: 'u1', username: 'alice', role: 'CUSTOMER' });
    expect(result).not.toHaveProperty('passwordHash');
    expect(result).not.toHaveProperty('password');
  });

  it('always creates CUSTOMER regardless of any attempted role injection', async () => {
    const { auth, users } = makeService();
    users.findByUsername.mockResolvedValue(null);
    users.create.mockResolvedValue({ id: 'u2', username: 'bob', role: 'CUSTOMER', loyaltyBalance: 0, isActive: true });
    const result = await auth.register('bob', 'pw');
    expect(result.role).toBe('CUSTOMER');
  });

  it('rejects duplicate usernames with 409', async () => {
    const { auth, users } = makeService();
    users.findByUsername.mockResolvedValue(baseUser as any);
    await expect(auth.register('testuser', 'pw')).rejects.toBeInstanceOf(ConflictException);
  });
});

describe('AuthService.login', () => {
  it('returns an accessToken for valid credentials', async () => {
    const { auth, users } = makeService();
    users.findByUsername.mockResolvedValue(baseUser as any);
    const result = await auth.login('testuser', 'correct-password');
    expect(result).toHaveProperty('accessToken');
    expect(typeof result.accessToken).toBe('string');
    expect(result.accessToken.split('.').length).toBe(3);
  });

  it('rejects wrong password with same 401 as unknown user (no enumeration)', async () => {
    const { auth, users } = makeService();
    users.findByUsername.mockResolvedValue(baseUser as any);
    await expect(auth.login('testuser', 'wrong-password')).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('rejects unknown username with same 401 (no enumeration)', async () => {
    const { auth, users } = makeService();
    users.findByUsername.mockResolvedValue(null);
    await expect(auth.login('ghost', 'any')).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('rejects inactive accounts', async () => {
    const { auth, users } = makeService();
    users.findByUsername.mockResolvedValue({ ...baseUser, isActive: false } as any);
    await expect(auth.login('testuser', 'correct-password')).rejects.toBeInstanceOf(UnauthorizedException);
  });
});

describe('AuthService.getMe', () => {
  it('returns profile without sensitive fields', async () => {
    const { auth, users } = makeService();
    users.findById.mockResolvedValue({ id: 'u1', username: 'alice', role: 'CUSTOMER', loyaltyBalance: 42, isActive: true } as any);
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