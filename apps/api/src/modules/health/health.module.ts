import { Module } from '@nestjs/common';
import { HealthController } from './health.controller.js';
import { HealthService } from './health.service.js';
import { PrismaModule } from '../../database/prisma.module.js';
import { AppConfigModule } from '../../config/app-config.module.js';

@Module({
  imports: [PrismaModule, AppConfigModule],
  controllers: [HealthController],
  providers: [HealthService],
})
export class HealthModule {}
