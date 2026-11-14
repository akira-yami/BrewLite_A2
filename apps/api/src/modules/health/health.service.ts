import { Inject, Injectable, ServiceUnavailableException } from '@nestjs/common';
import type { AppConfig } from '../../config/app-config.js';
import { APP_CONFIG } from '../../config/app-config.module.js';
import { PrismaService } from '../../database/prisma.service.js';

@Injectable()
export class HealthService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  async check(): Promise<{ status: 'ok' }> {
    let timeout: NodeJS.Timeout | undefined;
    try {
      await Promise.race([
        this.prisma.$queryRaw`SELECT 1`,
        new Promise<never>((_, reject) => {
          timeout = setTimeout(() => reject(new Error('Health probe timed out')), this.config.healthTimeoutMs);
        }),
      ]);
      return { status: 'ok' };
    } catch {
      throw new ServiceUnavailableException({
        error: 'SERVICE_UNAVAILABLE',
        message: 'Service is not ready',
      });
    } finally {
      if (timeout) clearTimeout(timeout);
    }
  }
}
