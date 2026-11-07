import {
  Controller,
  Post,
  Headers,
  Body,
  UseGuards,
  BadRequestException,
} from '@nestjs/common';
import { PaymentsService } from './payments.service.js';
import { CreatePaymentDto } from './dto/create-payment.dto.js';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard.js';
import { RolesGuard } from '../../common/guards/roles.guard.js';
import { Roles } from '../../common/decorators/roles.decorator.js';
import { CurrentUser } from '../../common/decorators/current-user.decorator.js';
import type { JwtPayload } from '../../common/utils/jwt.js';

@Controller('payments')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('CUSTOMER')
export class PaymentsController {
  constructor(private readonly paymentsService: PaymentsService) {}

  /**
   * POST /api/v1/payments
   * Header: Idempotency-Key: <uuid or client key>
   * Body: { orderId, method }
   *
   * AT-FR-07.1 – AT-FR-07.5 compliance:
   *   - Missing Idempotency-Key → 400
   *   - Same key + same payload already SUCCEEDED → replay the stored result
   *   - Same key + different payload → 409 IDEMPOTENCY_KEY_REUSED
   *   - PROCESSING in-flight → 409 PAYMENT_IN_PROGRESS
   *   - Gateway timeout → 503 GATEWAY_TIMEOUT
   *   - Decline → 200 with status FAILED (not a HTTP error; client inspects status field)
   */
  @Post()
  async pay(
    @CurrentUser() user: JwtPayload,
    @Headers('idempotency-key') rawKey: string | undefined,
    @Body() dto: CreatePaymentDto,
  ) {
    // AT-FR-07.1: key is mandatory
    const idempotencyKey = (rawKey ?? '').trim();
    if (!idempotencyKey) {
      throw new BadRequestException('Idempotency-Key header is required');
    }
    if (idempotencyKey.length > 100) {
      throw new BadRequestException('Idempotency-Key must be at most 100 characters');
    }

    const result = await this.paymentsService.pay(
      user.sub,
      dto.orderId,
      dto.method,
      idempotencyKey,
    );

    return { success: true, data: result };
  }
}
