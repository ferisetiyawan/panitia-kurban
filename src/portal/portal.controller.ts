import {
  Controller,
  Post,
  Get,
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

  @Post('auth/login')
  async login(@Body() body: { phone: string }) {
    if (!body.phone) {
      throw new BadRequestException('Nomor WhatsApp wajib diisi');
    }
    return this.portalService.login(body.phone);
  }

  @Get('me')
  @UseGuards(PortalJwtGuard)
  getProfile(@Request() req: any) {
    return this.portalService.getProfile(req.user.id);
  }

  @Get('form-response')
  @UseGuards(PortalJwtGuard)
  getFormResponse(@Request() req: any) {
    return this.portalService.getFormResponse(req.user.id);
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
