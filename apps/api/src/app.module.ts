import { Module } from '@nestjs/common';
import { CatalogModule } from './modules/catalog/catalog.module.js';
import { AuthModule } from './modules/auth/auth.module.js';
import { OrdersModule } from './modules/orders/orders.module.js';
import { PaymentsModule } from './modules/payments/payments.module.js';

@Module({
  imports: [CatalogModule, AuthModule, OrdersModule, PaymentsModule],
})
export class AppModule {}
