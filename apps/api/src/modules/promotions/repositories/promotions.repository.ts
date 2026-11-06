import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../database/prisma.service.js';
import type {
  Coupon,
  DiscountType,
  Prisma,
} from '../../../generated/prisma/client.js';

interface RawLockedCouponRow {
  id: string;
  code: string;
  discount_type?: DiscountType;
  discountType?: DiscountType;
  discount_value?: bigint | number | string;
  discountValue?: bigint | number | string;
  max_discount?: bigint | number | string | null;
  maxDiscount?: bigint | number | string | null;
  min_order_value?: bigint | number | string;
  minOrderValue?: bigint | number | string;
  usage_limit?: number | null;
  usageLimit?: number | null;
  per_user_limit?: number;
  perUserLimit?: number;
  starts_at?: Date | string;
  startsAt?: Date | string;
  ends_at?: Date | string;
  endsAt?: Date | string;
  is_active?: boolean;
  isActive?: boolean;
  created_at?: Date | string;
  createdAt?: Date | string;
  updated_at?: Date | string;
  updatedAt?: Date | string;
}

@Injectable()
export class PromotionsRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findByCode(code: string, tx?: Prisma.TransactionClient) {
    const client = tx ?? this.prisma;
    return client.coupon.findUnique({
      where: { code },
    });
  }

  async lockCoupon(
    code: string,
    tx: Prisma.TransactionClient,
  ): Promise<Coupon | null> {
    const rows = await tx.$queryRaw<RawLockedCouponRow[]>`
      SELECT
        "id",
        "code",
        "discount_type",
        "discount_value",
        "max_discount",
        "min_order_value",
        "usage_limit",
        "per_user_limit",
        "starts_at",
        "ends_at",
        "is_active",
        "created_at",
        "updated_at"
      FROM "coupons"
      WHERE "code" = ${code}
      FOR UPDATE
    `;

    if (rows.length === 0) {
      return null;
    }

    const row = rows[0];
    const rawMaxDiscount = row.max_discount ?? row.maxDiscount ?? null;

    return {
      id: row.id,
      code: row.code,
      discountType: (row.discount_type ?? row.discountType) as DiscountType,
      discountValue: BigInt(row.discount_value ?? row.discountValue ?? 0),
      maxDiscount: rawMaxDiscount !== null ? BigInt(rawMaxDiscount) : null,
      minOrderValue: BigInt(row.min_order_value ?? row.minOrderValue ?? 0),
      usageLimit: row.usage_limit ?? row.usageLimit ?? null,
      perUserLimit: Number(row.per_user_limit ?? row.perUserLimit ?? 1),
      startsAt: new Date(row.starts_at ?? row.startsAt ?? 0),
      endsAt: new Date(row.ends_at ?? row.endsAt ?? 0),
      isActive: Boolean(row.is_active ?? row.isActive ?? false),
      createdAt: new Date(row.created_at ?? row.createdAt ?? 0),
      updatedAt: new Date(row.updated_at ?? row.updatedAt ?? 0),
    };
  }

  async countRedemptions(
    couponId: string,
    userId: string,
    now: Date,
    tx?: Prisma.TransactionClient,
  ) {
    const client = tx ?? this.prisma;
    return client.couponRedemption.count({
      where: {
        couponId,
        userId,
        OR: [
          { status: 'CONSUMED' },
          { status: 'RESERVED', OR: [
            { expiresAt: { gt: now } },
            { order: { payments: { some: { status: 'PROCESSING' } } } },
          ] },
        ],
      },
    });
  }

  async countTotalRedemptions(
    couponId: string,
    now: Date,
    tx?: Prisma.TransactionClient,
  ) {
    const client = tx ?? this.prisma;
    return client.couponRedemption.count({
      where: {
        couponId,
        OR: [
          { status: 'CONSUMED' },
          { status: 'RESERVED', OR: [
            { expiresAt: { gt: now } },
            { order: { payments: { some: { status: 'PROCESSING' } } } },
          ] },
        ],
      },
    });
  }

  async createRedemption(
    data: {
      couponId: string;
      userId: string;
      orderId: string;
      discountAmount: bigint;
      expiresAt: Date;
    },
    tx?: Prisma.TransactionClient,
  ) {
    const client = tx ?? this.prisma;
    return client.couponRedemption.create({
      data: {
        couponId: data.couponId,
        userId: data.userId,
        orderId: data.orderId,
        discountAmount: data.discountAmount,
        status: 'RESERVED',
        expiresAt: data.expiresAt,
      },
    });
  }

  async consumeByOrderId(
    orderId: string,
    consumedAt: Date,
    tx?: Prisma.TransactionClient,
  ): Promise<number> {
    const client = tx ?? this.prisma;
    const result = await client.couponRedemption.updateMany({
      where: {
        orderId,
        status: 'RESERVED',
      },
      data: {
        status: 'CONSUMED',
        consumedAt,
      },
    });
    return result.count;
  }

  async releaseByOrderId(
    orderId: string,
    targetStatus: 'RELEASED' | 'EXPIRED',
    releasedAt: Date,
    tx?: Prisma.TransactionClient,
  ): Promise<number> {
    const client = tx ?? this.prisma;
    const result = await client.couponRedemption.updateMany({
      where: {
        orderId,
        status: 'RESERVED',
      },
      data: {
        status: targetStatus,
        releasedAt,
      },
    });
    return result.count;
  }
}
