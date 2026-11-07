import { Module } from '@nestjs/common';
import { PaymentsController } from './payments.controller.js';
import { PaymentsService } from './payments.service.js';
import { PrismaService } from '../../database/prisma.service.js';
import { Reflector } from '@nestjs/core';

@Module({
  controllers: [PaymentsController],
  providers: [PaymentsService, PrismaService, Reflector],
  exports: [PaymentsService],
})
export class PaymentsModule {}
