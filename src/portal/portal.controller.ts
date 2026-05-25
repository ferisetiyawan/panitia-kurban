import {
  Controller,
  Post,
  Get,
  Patch,
  Body,
  Res,
  UseGuards,
  Request,
  BadRequestException,
} from '@nestjs/common';
import type { Response } from 'express';
import { PortalService } from './portal.service';
import { PortalJwtGuard } from './portal-jwt.guard';

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

  @Get('me')
  @UseGuards(PortalJwtGuard)
  getProfile(@Request() req: any) {
    return this.portalService.getProfile(req.user.id);
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
