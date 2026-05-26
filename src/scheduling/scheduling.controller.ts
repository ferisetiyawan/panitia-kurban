import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  UseGuards,
  BadRequestException,
  ServiceUnavailableException,
  Res,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { Role } from '../common/enums/role.enum';
import { SchedulingService } from './scheduling.service';
import type { Team } from './scheduling.service';
import { SchedulingBroadcastService, BroadcastTarget } from './scheduling-broadcast.service';
import type { Response } from 'express';
import { SchedulingPdfService } from './scheduling-pdf.service';

@Controller('api/scheduling')
@UseGuards(AuthGuard('jwt'), RolesGuard)
export class SchedulingController {
  constructor(
    private readonly service: SchedulingService,
    private readonly broadcast: SchedulingBroadcastService,
    private readonly pdf: SchedulingPdfService,
  ) {}

  @Get()
  @Roles(Role.SUPER_ADMIN, Role.KETUA_PANITIA, Role.PANITIA_VOUCHER, Role.PANITIA_SCANNER)
  async list(@Query('eventId') eventId: string, @Query('team') team?: Team) {
    if (!eventId) throw new BadRequestException('eventId required');
    return this.service.getSchedule(eventId, team);
  }

  @Get('seset')
  @Roles(Role.SUPER_ADMIN, Role.KETUA_PANITIA, Role.PANITIA_VOUCHER, Role.PANITIA_SCANNER)
  async sesetData(@Query('eventId') eventId: string, @Query('team') team?: Team) {
    if (!eventId) throw new BadRequestException('eventId required');
    return this.service.getSesetData(eventId, team);
  }

  @Post('generate')
  @Roles(Role.SUPER_ADMIN, Role.KETUA_PANITIA)
  async generate(@Body() body: { eventId: string }) {
    if (!body?.eventId) throw new BadRequestException('eventId required');
    return this.service.generateSchedule(body.eventId);
  }

  @Patch(':animalId')
  @Roles(Role.SUPER_ADMIN, Role.KETUA_PANITIA)
  async patch(
    @Param('animalId') animalId: string,
    @Body() body: { scheduledAt?: string | null; scheduledTeam?: Team | null; scheduledNote?: string | null },
  ) {
    return this.service.updateSlot(animalId, {
      scheduledAt:
        body.scheduledAt === undefined
          ? undefined
          : body.scheduledAt
            ? new Date(body.scheduledAt)
            : null,
      scheduledTeam: body.scheduledTeam,
      scheduledNote: body.scheduledNote,
    });
  }

  @Delete()
  @Roles(Role.SUPER_ADMIN, Role.KETUA_PANITIA)
  async clear(@Body() body: { eventId: string }) {
    if (!body?.eventId) throw new BadRequestException('eventId required');
    return this.service.clearSchedule(body.eventId);
  }

  @Post('broadcast')
  @Roles(Role.SUPER_ADMIN, Role.KETUA_PANITIA)
  async sendBroadcast(
    @Body() body: { eventId: string; target: BroadcastTarget; dryRun?: boolean },
  ) {
    if (!body?.eventId || !body?.target) {
      throw new BadRequestException('eventId + target required');
    }
    const jid = this.broadcast.resolveGroupJid(body.target);
    if (!jid) {
      throw new ServiceUnavailableException(`Grup ${body.target} belum dikonfigurasi (env)`);
    }
    const message =
      body.target === 'sohibul_group'
        ? await this.broadcast.buildSohibulMessage(body.eventId)
        : await this.broadcast.buildPanitiaMessage(body.eventId, {});
    if (body.dryRun) {
      return { sent: false, preview: message, group_jid: jid };
    }
    await this.broadcast.sendToGroup(jid, message);
    return { sent: true, group_jid: jid };
  }

  @Get('pdf')
  @Roles(Role.SUPER_ADMIN, Role.KETUA_PANITIA, Role.PANITIA_VOUCHER)
  async exportPdf(@Query('eventId') eventId: string, @Res() res: Response) {
    if (!eventId) throw new BadRequestException('eventId required');
    const buf = await this.pdf.generate(eventId);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="jadwal-${eventId.slice(0, 8)}.pdf"`);
    res.end(buf);
  }
}
