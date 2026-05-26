import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';

export interface PortalJwtPayload {
  sub: string; // pengkurbanId
  type: 'sohibul';
  name: string;
  phone?: string; // local 08xxx form, used to validate switch within same phone
  impersonatedBy?: string; // admin user id, set when admin impersonating
}

@Injectable()
export class PortalJwtStrategy extends PassportStrategy(
  Strategy,
  'portal-jwt',
) {
  constructor() {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: process.env.JWT_SECRET || 'panitia-kurban-secret-key-2026',
    });
  }

  validate(payload: PortalJwtPayload) {
    if (payload.type !== 'sohibul') {
      throw new UnauthorizedException('Token bukan portal token');
    }
    return {
      id: payload.sub,
      name: payload.name,
      type: 'sohibul',
      phone: payload.phone,
      impersonatedBy: payload.impersonatedBy,
    };
  }
}
