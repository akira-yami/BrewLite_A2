import { CanActivate, ExecutionContext, ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import { UserRole } from '../../../generated/prisma/client.js';

@Injectable()
export class OwnershipGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest();
    const user = request?.user;

    if (!user || !user.id) {
      throw new UnauthorizedException();
    }

    if (user.role === UserRole.BARISTA) {
      return true;
    }

    const params = request.params ?? {};
    const targetUserId = params.userId || params.id;

    if (!targetUserId || targetUserId !== user.id) {
      throw new ForbiddenException({
        error: {
          code: 'FORBIDDEN_RESOURCE',
          message: 'Bạn không có quyền truy cập dữ liệu của người dùng khác.',
        },
      });
    }

    return true;
  }
}
