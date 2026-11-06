import { ExecutionContext, ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { beforeEach, describe, expect, it } from 'vitest';
import { OwnershipGuard } from './ownership.guard.js';
import { UserRole } from '../../../generated/prisma/client.js';

describe('OwnershipGuard (Unit Test - TDD)', () => {
  let guard: OwnershipGuard;

  beforeEach(() => {
    guard = new OwnershipGuard();
  });

  const createMockContext = (
    user?: { id?: string; role?: UserRole },
    params?: Record<string, string>,
  ) => {
    return {
      switchToHttp: () => ({
        getRequest: () => ({
          user,
          params: params ?? {},
        }),
      }),
    } as unknown as ExecutionContext;
  };

  it('throws UnauthorizedException if request has no authenticated user', () => {
    const context = createMockContext(undefined, { userId: 'user-1' });

    expect(() => guard.canActivate(context)).toThrow(UnauthorizedException);
  });

  it('allows access if user has elevated BARISTA role regardless of target userId', () => {
    const context = createMockContext(
      { id: 'barista-1', role: UserRole.BARISTA },
      { userId: 'customer-2' },
    );

    expect(guard.canActivate(context)).toBe(true);
  });

  it('allows access if CUSTOMER accesses their own resource matching userId param', () => {
    const context = createMockContext(
      { id: 'customer-1', role: UserRole.CUSTOMER },
      { userId: 'customer-1' },
    );

    expect(guard.canActivate(context)).toBe(true);
  });

  it('allows access if CUSTOMER accesses their own resource matching id param', () => {
    const context = createMockContext(
      { id: 'customer-1', role: UserRole.CUSTOMER },
      { id: 'customer-1' },
    );

    expect(guard.canActivate(context)).toBe(true);
  });

  it('throws ForbiddenException with FORBIDDEN_RESOURCE if CUSTOMER accesses another user resource', () => {
    const context = createMockContext(
      { id: 'customer-1', role: UserRole.CUSTOMER },
      { userId: 'customer-2' },
    );

    try {
      guard.canActivate(context);
      expect.fail('Should have thrown ForbiddenException');
    } catch (err) {
      expect(err).toBeInstanceOf(ForbiddenException);
      const res = (err as ForbiddenException).getResponse() as any;
      expect(res.error.code).toBe('FORBIDDEN_RESOURCE');
      expect(res.error.message).toBe('Bạn không có quyền truy cập dữ liệu của người dùng khác.');
    }
  });

  it('throws ForbiddenException if CUSTOMER accesses route with no id or userId param', () => {
    const context = createMockContext(
      { id: 'customer-1', role: UserRole.CUSTOMER },
      {},
    );

    expect(() => guard.canActivate(context)).toThrow(ForbiddenException);
  });
});
