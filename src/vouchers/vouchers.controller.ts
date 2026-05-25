import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  Res,
  UseGuards,
  Request,
  BadRequestException,
} from '@nestjs/common';
import type { Response } from 'express';
import { AuthGuard } from '@nestjs/passport';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { Role } from '../common/enums/role.enum';
import { VouchersService } from './vouchers.service';

@Controller('api/vouchers')
@UseGuards(AuthGuard('jwt'), RolesGuard)
export class VouchersController {
  constructor(private vouchersService: VouchersService) {}

  @Get()
  findAll(
    @Query('eventId') eventId?: string,
    @Query('status') status?: string,
    @Query('search') search?: string,
    @Query('distributionDate') distributionDate?: string,
    @Query('pickupCluster') pickupCluster?: string,
    @Query('pickupSearch') pickupSearch?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    const pageNum = page ? parseInt(page, 10) : undefined;
    const limitNum = limit ? parseInt(limit, 10) : undefined;
    return this.vouchersService.findAll(
      eventId,
      status,
      search,
      distributionDate,
      pageNum,
      limitNum,
      pickupCluster,
      pickupSearch,
    );
  }

  @Get('export')
  @Roles(Role.SUPER_ADMIN, Role.KETUA_PANITIA, Role.PANITIA_VOUCHER)
  async exportCsv(
    @Query('eventId') eventId: string | undefined,
    @Query('status') status: string | undefined,
    @Res() res: Response,
  ) {
    const csv = await this.vouchersService.exportCsv(eventId, status);
    res.header('Content-Type', 'text/csv');
    res.attachment('vouchers.csv');
    return res.send(csv);
  }

  @Get('stats')
  stats(@Query('eventId') eventId?: string) {
    return this.vouchersService.stats(eventId);
  }

  @Get('scan-logs')
  @Roles(Role.SUPER_ADMIN, Role.KETUA_PANITIA)
  scanLogs(@Query('eventId') eventId?: string) {
    return this.vouchersService.getScanLogs(eventId);
  }

  @Get('batch-pdf')
  @Roles(Role.SUPER_ADMIN, Role.KETUA_PANITIA, Role.PANITIA_VOUCHER)
  async downloadBatchPdf(
    @Query('eventId') eventId: string,
    @Res() res: Response,
  ) {
    if (!eventId) {
      throw new BadRequestException('eventId is required');
    }
    const buffer = await this.vouchersService.generateBatchPdf(eventId);
    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename=vouchers-batch-${eventId}.pdf`,
      'Content-Length': buffer.length,
    });
    res.end(buffer);
  }

  // ─── Bulk operations (BEFORE :id routes!) ───

  @Post('selected-pdf')
  @Roles(Role.SUPER_ADMIN, Role.KETUA_PANITIA, Role.PANITIA_VOUCHER)
  async downloadSelectedPdf(
    @Body() body: { ids: string[] },
    @Res() res: Response,
  ) {
    if (!body.ids || !body.ids.length) {
      throw new BadRequestException('ids array is required');
    }
    const buffer = await this.vouchersService.generateSelectedPdf(body.ids);
    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename=vouchers-selected.pdf`,
      'Content-Length': buffer.length,
    });
    res.end(buffer);
  }

  @Post('bulk-delete')
  @Roles(Role.SUPER_ADMIN, Role.KETUA_PANITIA, Role.PANITIA_VOUCHER)
  bulkDelete(@Body() body: { ids: string[] }) {
    if (!body.ids || !body.ids.length) {
      throw new BadRequestException('ids array is required');
    }
    return this.vouchersService.bulkDelete(body.ids);
  }

  @Patch('bulk-update-date')
  @Roles(Role.SUPER_ADMIN, Role.KETUA_PANITIA, Role.PANITIA_VOUCHER)
  bulkUpdateDate(@Body() body: { ids: string[]; distributionDate: string }) {
    if (!body.ids || !body.ids.length || !body.distributionDate) {
      throw new BadRequestException(
        'ids array and distributionDate are required',
      );
    }
    return this.vouchersService.bulkUpdateDate(body.ids, body.distributionDate);
  }

  // ─── Single item routes ───

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.vouchersService.findById(id);
  }

  @Patch(':id/date')
  @Roles(Role.SUPER_ADMIN, Role.KETUA_PANITIA, Role.PANITIA_VOUCHER)
  updateDate(
    @Param('id') id: string,
    @Body() body: { distributionDate: string },
  ) {
    if (!body.distributionDate) {
      throw new BadRequestException('distributionDate is required');
    }
    return this.vouchersService.updateDistributionDate(
      id,
      body.distributionDate,
    );
  }

  @Post()
  @Roles(Role.SUPER_ADMIN, Role.KETUA_PANITIA, Role.PANITIA_VOUCHER)
  create(
    @Body() body: { eventId: string; distributionDate: string },
    @Request() req: any,
  ) {
    return this.vouchersService.create(
      body.eventId,
      body.distributionDate,
      req.user.id,
    );
  }

  @Post('batch')
  @Roles(Role.SUPER_ADMIN, Role.KETUA_PANITIA, Role.PANITIA_VOUCHER)
  createBatch(
    @Body() body: { eventId: string; count: number; distributionDate: string },
    @Request() req: any,
  ) {
    return this.vouchersService.createBatch(
      body.eventId,
      body.count,
      body.distributionDate,
      req.user.id,
    );
  }

  @Post('scan')
  @Roles(Role.SUPER_ADMIN, Role.KETUA_PANITIA, Role.PANITIA_SCANNER)
  scan(@Body() body: { voucherCode: string }, @Request() req: any) {
    return this.vouchersService.scan(body.voucherCode, req.user.id);
  }

  @Post('scan-pickup')
  @Roles(Role.SUPER_ADMIN, Role.KETUA_PANITIA, Role.PANITIA_SCANNER)
  scanPickup(
    @Body()
    body: {
      voucherCode: string;
      pickupCluster: string;
      pickupUnit: string;
      pickupPhone?: string;
    },
    @Request() req: any,
  ) {
    if (!body.voucherCode || !body.pickupCluster || !body.pickupUnit) {
      throw new BadRequestException(
        'voucherCode, pickupCluster, dan pickupUnit wajib diisi',
      );
    }
    const validClusters = ['MARGATA', 'NAHARA', 'UENOS', 'LAINNYA'];
    if (!validClusters.includes(body.pickupCluster)) {
      throw new BadRequestException(
        `pickupCluster harus salah satu dari: ${validClusters.join(', ')}`,
      );
    }
    return this.vouchersService.scanPickup(
      body.voucherCode,
      req.user.id,
      body.pickupCluster,
      body.pickupUnit,
      body.pickupPhone,
    );
  }

  @Delete(':id')
  @Roles(Role.SUPER_ADMIN, Role.KETUA_PANITIA, Role.PANITIA_VOUCHER)
  remove(@Param('id') id: string) {
    return this.vouchersService.remove(id);
  }
}
