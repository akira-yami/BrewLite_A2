import { Injectable, UnauthorizedException } from '@nestjs/common';
import type { Prisma } from '../../generated/prisma/client.js';

@Injectable()
export class UsersService {
  async assertActiveCustomer(tx: Prisma.TransactionClient, id: string) {
    const user = await tx.user.findFirst({
      where: { id, isActive: true, role: 'CUSTOMER' },
      select: { id: true },
    });
    if (!user) throw new UnauthorizedException();
  }

  /**
   * JWT chỉ mang role tại thời điểm đăng nhập. Trước khi đổi trạng thái đơn,
   * xác nhận lại trong DB rằng tài khoản vẫn đang hoạt động và là BARISTA.
   */
  async assertActiveBarista(tx: Prisma.TransactionClient, id: string) {
    const user = await tx.user.findFirst({
      where: { id, isActive: true, role: 'BARISTA' },
      select: { id: true },
    });
    if (!user) throw new UnauthorizedException();
  }
}
