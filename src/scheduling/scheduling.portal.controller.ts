import { Controller, Get, UseGuards, Request, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, In, Not, IsNull } from 'typeorm';
import { PortalJwtGuard } from '../portal/portal-jwt.guard';
import { Animal } from '../animals/animal.entity';
import { Pengkurban } from '../pengkurban/pengkurban.entity';

const KOLEKTIF_TYPES = ['SAPI_KOLEKTIF_A', 'SAPI_KOLEKTIF_B', 'SAPI_KOLEKTIF_C'];

@Controller('api/portal/scheduling')
export class SchedulingPortalController {
  private readonly logger = new Logger(SchedulingPortalController.name);

  constructor(
    @InjectRepository(Animal)
    private readonly animalRepo: Repository<Animal>,
    @InjectRepository(Pengkurban)
    private readonly pengkurbanRepo: Repository<Pengkurban>,
  ) {}

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

    // 1. Find all pengkurban with this phone (could be multiple registrations)
    const pengkurban = await this.pengkurbanRepo.find({ where: { phone } });
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
