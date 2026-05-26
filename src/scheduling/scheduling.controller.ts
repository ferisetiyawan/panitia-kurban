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
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { Role } from '../common/enums/role.enum';
import { SchedulingService } from './scheduling.service';
import type { Team } from './scheduling.service';

@Controller('api/scheduling')
@UseGuards(AuthGuard('jwt'), RolesGuard)
export class SchedulingController {
  constructor(private readonly service: SchedulingService) {}

  @Get()
  @Roles(Role.SUPER_ADMIN, Role.KETUA_PANITIA, Role.PANITIA_VOUCHER, Role.PANITIA_SCANNER)
  async list(@Query('eventId') eventId: string, @Query('team') team?: Team) {
    if (!eventId) throw new BadRequestException('eventId required');
    return this.service.getSchedule(eventId, team);
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
}
