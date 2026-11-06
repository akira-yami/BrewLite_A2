import { CatalogModule } from '../catalog/catalog.module.js';
import { UsersService } from '../users/users.service.js';

import { Module } from '@nestjs/common';
import { AppConfigModule } from '../../config/app-config.module.js';
import { PrismaModule } from '../../database/prisma.module.js';
import { InventoryModule } from '../inventory/inventory.module.js';
import { PromotionsModule } from '../promotions/promotions.module.js';
import { OrdersController } from './controllers/orders.controller.js';
import { StaffOrdersController } from './controllers/staff-orders.controller.js';
import { OrdersRepository } from './repositories/orders.repository.js';
import { OrderExpiryJob } from './services/order-expiry.job.js';
import { OrdersService } from './services/orders.service.js';

@Module({
  imports: [AppConfigModule, PrismaModule, PromotionsModule, CatalogModule, InventoryModule],
  controllers: [OrdersController, StaffOrdersController],
  providers: [OrdersRepository, OrdersService, UsersService, OrderExpiryJob],
  exports: [OrdersService],
})
export class OrdersModule {}
