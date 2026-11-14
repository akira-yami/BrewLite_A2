import { Controller, Get, Inject } from '@nestjs/common';
import { HealthService } from './health.service.js';

@Controller('health')
export class HealthController {
  constructor(@Inject(HealthService) private readonly healthService: HealthService) {}

  @Get()
  async health(): Promise<{ success: true; data: { status: 'ok' } }> {
    return { success: true, data: await this.healthService.check() };
  }
}
