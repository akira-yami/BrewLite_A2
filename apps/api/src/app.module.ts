import { Module } from '@nestjs/common';
import { CatalogModule } from './modules/catalog/catalog.module.js';
import { AuthModule } from './modules/auth/auth.module.js';
import { OrdersModule } from './modules/orders/orders.module.js';
import { InventoryModule } from './modules/inventory/inventory.module.js';
import { PromotionsModule } from './modules/promotions/promotions.module.js';
import { PrismaModule } from './database/prisma.module.js';

@Module({
  imports: [
    PrismaModule,
    AuthModule,
    CatalogModule,
    InventoryModule,
    OrdersModule,
    PromotionsModule,
  ],
})
export class AppModule {}