import {
  Controller,
  Get,
  UseGuards,
  Request,
  Logger,
  Query,
  BadRequestException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, In, Not, IsNull } from 'typeorm';
import { PortalJwtGuard } from '../portal/portal-jwt.guard';
import { Animal } from '../animals/animal.entity';
import { Pengkurban } from '../pengkurban/pengkurban.entity';
import { SchedulingService } from './scheduling.service';
import type { Team } from './scheduling.service';

const KOLEKTIF_TYPES = ['SAPI_KOLEKTIF_A', 'SAPI_KOLEKTIF_B', 'SAPI_KOLEKTIF_C'];

@Controller('api/portal/scheduling')
export class SchedulingPortalController {
  private readonly logger = new Logger(SchedulingPortalController.name);

  constructor(
    @InjectRepository(Animal)
    private readonly animalRepo: Repository<Animal>,
    @InjectRepository(Pengkurban)
    private readonly pengkurbanRepo: Repository<Pengkurban>,
    private readonly schedulingService: SchedulingService,
  ) {}

  /**
   * PUBLIC (no auth) ops snapshot — read-only view-friendly endpoint for
   * /operasional.html when accessed by general public (sohibul or visitor).
   * Returns same shape as the authenticated /api/scheduling/ops endpoint.
   */
  @Get('ops-public')
  async opsPublic(
    @Query('eventId') eventId: string,
    @Query('team') team?: Team,
  ) {
    if (!eventId) throw new BadRequestException('eventId required');
    return this.schedulingService.getOpsData(eventId, team);
  }

  @Get('me')
  @UseGuards(PortalJwtGuard)
  async myJadwal(@Request() req: any): Promise<
    Array<{
      id: string;
      animalCode: string;
      animalType: string;
      scheduledAt: Date | null;
      scheduledTeam: string | null;
    }>
  > {
    const phone: string | undefined = req.user?.phone;
    if (!phone) return [];

    // 1. Find all pengkurban with this phone (could be multiple registrations).
    // Match both local (08xxx) and international (628xxx) phone forms.
    // Mirror logic from portal.service.ts findAllPengkurbanByPhone.
    const digits = phone.replace(/\D/g, '');
    let form1: string;
    let form2: string;
    if (digits.startsWith('62')) {
      form1 = '0' + digits.slice(2);
      form2 = digits;
    } else if (digits.startsWith('0')) {
      form1 = digits;
      form2 = '62' + digits.slice(1);
    } else {
      // Unknown form — query as-is
      form1 = digits;
      form2 = digits;
    }
    const pengkurban = await this.pengkurbanRepo
      .createQueryBuilder('p')
      .where('p.phone = :form1 OR p.phone = :form2', { form1, form2 })
      .getMany();
    if (pengkurban.length === 0) return [];

    const pkIds = pengkurban.map((p) => p.id);
    const eventIds = [...new Set(pengkurban.map((p) => p.eventId))];
    const kolektifTypes = [
      ...new Set(
        pengkurban
          .filter((p) => KOLEKTIF_TYPES.includes(p.animalType))
          .map((p) => p.animalType),
      ),
    ];

    // 2. Direct animals (individual): linked by pengkurban_id
    const direct = await this.animalRepo.find({
      where: {
        pengkurbanId: In(pkIds),
        scheduledAt: Not(IsNull()),
      },
    });

    // 3. Kolektif animals: matched by (event_id, animal_type)
    const kolektif =
      kolektifTypes.length > 0
        ? await this.animalRepo.find({
            where: {
              eventId: In(eventIds),
              animalType: In(kolektifTypes) as any,
              scheduledAt: Not(IsNull()),
            },
          })
        : [];

    // 4. Merge + dedup + project
    const map = new Map<string, Animal>();
    for (const a of [...direct, ...kolektif]) map.set(a.id, a);
    const merged = [...map.values()].sort(
      (a, b) =>
        (a.scheduledAt?.getTime() ?? 0) - (b.scheduledAt?.getTime() ?? 0),
    );
    return merged.map((a) => ({
      id: a.id,
      animalCode: a.animalCode,
      animalType: a.animalType,
      scheduledAt: a.scheduledAt,
      scheduledTeam: a.scheduledTeam,
    }));
  }
}
