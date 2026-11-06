import {
  ForbiddenException,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Query,
  UseGuards,
} from '@nestjs/common';
import { UserRole } from '../../../generated/prisma/client.js';
import { CurrentUser } from '../../auth/decorators/current-user.decorator.js';
import { Roles } from '../../auth/decorators/roles.decorator.js';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard.js';
import { RolesGuard } from '../../auth/guards/roles.guard.js';
import { StaffInventoryQueryDto } from '../dto/staff-inventory.dto.js';
import { InventoryService } from '../services/inventory.service.js';

@Controller('staff/inventory')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.BARISTA)
export class StaffInventoryController {
  constructor(private readonly inventory: InventoryService) {}

  @Get()
  list(
    @CurrentUser() user: { id: string },
    @Query() query: StaffInventoryQueryDto,
  ) {
    return this.inventory.listIngredients(user.id, query);
  }

  @Get(':id')
  async detail(
    @CurrentUser() user: { id: string },
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return { data: await this.inventory.getIngredient(user.id, id) };
  }

  // Keep an explicit denial for old clients; a hidden UI is not authorization.
  @Patch(':id/stock')
  update() {
    throw new ForbiddenException({
      error: {
        code: 'FORBIDDEN_RESOURCE',
        message: 'Barista chỉ được xem tồn kho, không được cập nhật số lượng.',
      },
    });
  }
}
