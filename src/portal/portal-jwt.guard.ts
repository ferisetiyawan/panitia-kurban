import { Injectable } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';

@Injectable()
export class PortalJwtGuard extends AuthGuard('portal-jwt') {}
