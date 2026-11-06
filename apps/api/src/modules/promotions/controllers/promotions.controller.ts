import { Body, Controller, HttpCode, HttpStatus, Post, UseGuards } from '@nestjs/common';
import { PromotionsService } from '../services/promotions.service.js';
import { ValidateCouponDto } from '../dto/validate-coupon.dto.js';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard.js';
import { RolesGuard } from '../../auth/guards/roles.guard.js';
import { Roles } from '../../auth/decorators/roles.decorator.js';
import { CurrentUser } from '../../auth/decorators/current-user.decorator.js';
import { UserRole } from '../../../generated/prisma/client.js';

@Controller('coupons')
export class PromotionsController {
    constructor(private readonly promotionsService: PromotionsService) {}

    @Post('validate')
    @HttpCode(HttpStatus.OK)
    @UseGuards(JwtAuthGuard, RolesGuard)
    @Roles(UserRole.CUSTOMER)
    async validate(
        @Body() dto: ValidateCouponDto,
        @CurrentUser() user: { sub: string; username: string; role: string },
    ) {
        const result = await this.promotionsService.validateCoupon(
            dto.code,
            dto.subtotal,
            user.sub,
            new Date(),
        );
        return { data: result };
    }
}