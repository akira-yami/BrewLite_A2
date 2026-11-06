import { Module } from '@nestjs/common';
import { loadAppConfig } from './app-config.js';

export const APP_CONFIG = Symbol('APP_CONFIG');

@Module({
  providers: [{ provide: APP_CONFIG, useFactory: loadAppConfig }],
  exports: [APP_CONFIG],
})
export class AppConfigModule {}
