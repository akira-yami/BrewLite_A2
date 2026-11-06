import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { RolesGuard } from './roles.guard.js';
import { UserRole } from '../../../generated/prisma/client.js';

describe('RolesGuard (Unit Test - TDD)', () => {
  let guard: RolesGuard;
  let reflector: Reflector;

  beforeEach(() => {
    reflector = new Reflector();
    guard = new RolesGuard(reflector);
  });

  const createMockContext = (user?: { role?: UserRole }) => {
    return {
      getHandler: vi.fn(),
      getClass: vi.fn(),
      switchToHttp: () => ({
        getRequest: () => ({ user }),
      }),
    } as unknown as ExecutionContext;
  };

  it('should allow access if no roles are required', () => {
    vi.spyOn(reflector, 'getAllAndOverride').mockReturnValue(undefined);
    const context = createMockContext();

    expect(guard.canActivate(context)).toBe(true);
  });

  it('should allow access if requiredRoles array is empty', () => {
    vi.spyOn(reflector, 'getAllAndOverride').mockReturnValue([]);
    const context = createMockContext();

    expect(guard.canActivate(context)).toBe(true);
  });

  it('should allow access if user has the required role', () => {
    vi.spyOn(reflector, 'getAllAndOverride').mockReturnValue([UserRole.BARISTA]);
    const context = createMockContext({ role: UserRole.BARISTA });

    expect(guard.canActivate(context)).toBe(true);
  });

  it('should throw ForbiddenException with FORBIDDEN_RESOURCE if user has insufficient role', () => {
    vi.spyOn(reflector, 'getAllAndOverride').mockReturnValue([UserRole.BARISTA]);
    const context = createMockContext({ role: UserRole.CUSTOMER });

    try {
      guard.canActivate(context);
      expect.fail('Should have thrown ForbiddenException');
    } catch (err) {
      expect(err).toBeInstanceOf(ForbiddenException);
      const response = (err as ForbiddenException).getResponse() as any;
      expect(response.error.code).toBe('FORBIDDEN_RESOURCE');
      expect(response.error.message).toBe('Bạn không có quyền truy cập chức năng này.');
    }
  });

  it('should throw ForbiddenException if request has no authenticated user', () => {
    vi.spyOn(reflector, 'getAllAndOverride').mockReturnValue([UserRole.BARISTA]);
    const context = createMockContext(undefined);

    try {
      guard.canActivate(context);
      expect.fail('Should have thrown ForbiddenException');
    } catch (err) {
      expect(err).toBeInstanceOf(ForbiddenException);
      const response = (err as ForbiddenException).getResponse() as any;
      expect(response.error.code).toBe('FORBIDDEN_RESOURCE');
    }
  });
});
