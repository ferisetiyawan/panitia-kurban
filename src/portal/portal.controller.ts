import {
  Controller,
  Post,
  Get,
  Patch,
  Param,
  Body,
  Res,
  UseGuards,
  Request,
  BadRequestException,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import type { Response } from 'express';
import { PortalService } from './portal.service';
import { PortalJwtGuard } from './portal-jwt.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { Role } from '../common/enums/role.enum';

@Controller('api/portal')
export class PortalController {
  constructor(private portalService: PortalService) {}

  @Post('auth/request-otp')
  async requestOtp(@Body() body: { phone: string }) {
    if (!body.phone) {
      throw new BadRequestException('Nomor WhatsApp wajib diisi');
    }
    return this.portalService.requestOtp(body.phone);
  }

  @Post('auth/verify-otp')
  async verifyOtp(@Body() body: { phone: string; code: string }) {
    if (!body.phone || !body.code) {
      throw new BadRequestException('Nomor WhatsApp dan kode OTP wajib diisi');
    }
    return this.portalService.verifyOtp(body.phone, body.code);
  }

  @Get('registrations')
  @UseGuards(PortalJwtGuard)
  listRegistrations(@Request() req: any) {
    if (!req.user.phone) return [];
    return this.portalService.listRegistrationsForPhone(req.user.phone);
  }

  @Post('auth/switch/:pengkurbanId')
  @UseGuards(PortalJwtGuard)
  switchRegistration(@Request() req: any, @Param('pengkurbanId') id: string) {
    if (!req.user.phone) {
      throw new BadRequestException('Token tidak punya phone — login ulang');
    }
    return this.portalService.switchRegistration(req.user.phone, id);
  }

  @Post('auth/impersonate/:pengkurbanId')
  @UseGuards(AuthGuard('jwt'), RolesGuard)
  @Roles(Role.SUPER_ADMIN, Role.KETUA_PANITIA, Role.PANITIA_VOUCHER)
  impersonate(@Request() req: any, @Param('pengkurbanId') id: string) {
    return this.portalService.impersonate(id, req.user.id);
  }

  @Get('me')
  @UseGuards(PortalJwtGuard)
  async getProfile(@Request() req: any) {
    const profile = await this.portalService.getProfile(req.user.id);
    return { ...profile, impersonatedBy: req.user.impersonatedBy || null };
  }

  @Patch('me')
  @UseGuards(PortalJwtGuard)
  updateProfile(
    @Request() req: any,
    @Body() body: { shohibulName?: string },
  ) {
    if (body.shohibulName === undefined) {
      throw new BadRequestException('Tidak ada field yang diupdate');
    }
    return this.portalService.updateShohibulName(req.user.id, body.shohibulName);
  }

  @Get('form-response')
  @UseGuards(PortalJwtGuard)
  getFormResponse(@Request() req: any) {
    return this.portalService.getFormResponse(req.user.id);
  }

  @Get('animals')
  @UseGuards(PortalJwtGuard)
  getAnimals(@Request() req: any) {
    return this.portalService.getAnimalsForSohibul(req.user.id);
  }

  @Get('report/pdf')
  @UseGuards(PortalJwtGuard)
  async downloadReport(@Request() req: any, @Res() res: Response) {
    const buffer = await this.portalService.generateReportPdf(req.user.id);
    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename=laporan-sohibul.pdf`,
      'Content-Length': buffer.length,
    });
    res.end(buffer);
  }
}
