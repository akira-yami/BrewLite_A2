import { Module } from '@nestjs/common';
import { PrismaModule } from '../../database/prisma.module.js';
import { AuthModule } from '../auth/auth.module.js';
import { PromotionsController } from './controllers/promotions.controller.js';
import { PromotionsService } from './services/promotions.service.js';
import { PromotionsRepository } from './repositories/promotions.repository.js';

@Module({
    imports: [PrismaModule, AuthModule],
    controllers: [PromotionsController],
    providers: [PromotionsService, PromotionsRepository],
    exports: [PromotionsService, PromotionsRepository],
})
export class PromotionsModule {}