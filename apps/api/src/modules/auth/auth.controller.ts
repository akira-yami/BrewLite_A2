import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, UseGuards } from '@nestjs/common';
import { AuthService } from './auth.service.js';
import { RegisterDto } from './dto/register.dto.js';
import { LoginDto } from './dto/login.dto.js';
import { JwtAuthGuard } from './guards/jwt-auth.guard.js';
import { RolesGuard } from './guards/roles.guard.js';
import { OwnershipGuard } from './guards/ownership.guard.js';
import { Roles } from './decorators/roles.decorator.js';
import { CurrentUser } from './decorators/current-user.decorator.js';
import { UserRole } from '../../generated/prisma/client.js';

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('register')
  @HttpCode(HttpStatus.CREATED)
  async register(@Body() dto: RegisterDto) {
    const result = await this.authService.register(dto);
    return { data: result };
  }

  @Post('login')
  @HttpCode(HttpStatus.OK)
  async login(@Body() dto: LoginDto) {
    const result = await this.authService.login(dto);
    return { data: result };
  }

  @Get('me')
  @UseGuards(JwtAuthGuard)
  async getMe(@CurrentUser() user: { sub: string; username: string; role: string }) {
    const profile = await this.authService.getProfile(user.sub);
    return { data: profile };
  }

  @Get('users/:userId')
  @UseGuards(JwtAuthGuard, OwnershipGuard)
  async getUserById(@Param('userId') userId: string) {
    const profile = await this.authService.getProfile(userId);
    return { data: profile };
  }

  @Get('barista-only')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.BARISTA)
  async baristaOnly() {
    return { data: { message: 'Chào Barista' } };
  }
}
