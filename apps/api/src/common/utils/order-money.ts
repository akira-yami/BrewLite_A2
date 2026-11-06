import { InternalServerErrorException } from '@nestjs/common';

export function orderMoney(value: bigint): number {
  if (value < 0n || value > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new InternalServerErrorException({
      error: {
        code: 'INTERNAL_ERROR',
        message: 'Order amount cannot be represented safely.',
      },
    });
  }
  return Number(value);
}
