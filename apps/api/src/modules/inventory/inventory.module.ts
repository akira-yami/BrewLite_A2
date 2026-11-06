import { AuthModule } from '../auth/auth.module.js';
import { UsersService } from '../users/users.service.js';
import { StaffInventoryController } from './controllers/staff-inventory.controller.js';
import { Module } from '@nestjs/common';
import { PrismaModule } from '../../database/prisma.module.js';
import { InventoryRepository } from './repositories/inventory.repository.js';
import { InventoryService } from './services/inventory.service.js';

@Module({
  imports: [PrismaModule, AuthModule],
  controllers: [StaffInventoryController],
  providers: [UsersService, InventoryRepository, InventoryService],
  exports: [InventoryService],
})
export class InventoryModule {}
