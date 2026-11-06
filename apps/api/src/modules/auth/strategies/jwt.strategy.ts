import { Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { APP_CONFIG } from '../../../config/app-config.module.js';
import { loadAppConfig, type AppConfig } from '../../../config/app-config.js';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(@Inject(APP_CONFIG) config: AppConfig = loadAppConfig()) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: config.jwtSecret,
      issuer: config.jwtIssuer,
      audience: config.jwtAudience,
    });
  }

  async validate(payload: { sub: string; username: string; role: string }) {
    if (!payload?.sub) {
      throw new UnauthorizedException();
    }
    return { id: payload.sub, sub: payload.sub, username: payload.username, role: payload.role };
  }
}
