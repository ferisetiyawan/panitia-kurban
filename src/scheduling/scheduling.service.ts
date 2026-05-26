import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, In } from 'typeorm';
import { Animal } from '../animals/animal.entity';
import { Pengkurban } from '../pengkurban/pengkurban.entity';
import { FormResponse } from '../form-responses/form-response.entity';
import { parsePreferensiTime, PreferensiTime } from './scheduling-mappers';

export type Team = 'SAPI' | 'KAMBING_DOMBA';

const KOLEKTIF_TYPES = ['SAPI_KOLEKTIF_A', 'SAPI_KOLEKTIF_B', 'SAPI_KOLEKTIF_C'];
const SAPI_TYPES = [...KOLEKTIF_TYPES, 'SAPI_PERORANGAN', 'SAPI_KOLEKTIF'];

export function teamOf(animalType: string): Team {
  if (SAPI_TYPES.includes(animalType)) return 'SAPI';
  return 'KAMBING_DOMBA';
}

export interface AnimalWithSohibul {
  animal: Animal;
  pengkurban: Pengkurban[];
}

export interface EligibleAnimal {
  animal: Animal;
  preferensi: PreferensiTime | null;
}

@Injectable()
export class SchedulingService {
  private readonly logger = new Logger(SchedulingService.name);

  constructor(
    @InjectRepository(Animal)
    private readonly animalRepo: Repository<Animal>,
    @InjectRepository(Pengkurban)
    private readonly pengkurbanRepo: Repository<Pengkurban>,
    @InjectRepository(FormResponse)
    private readonly formRepo: Repository<FormResponse>,
  ) {}

  /**
   * Animals already scheduled, with sohibul attached.
   * Individual: 1 pengkurban; kolektif: many; vendor: empty.
   * Ordered by scheduledAt ASC.
   */
  async getSchedule(eventId: string, team?: Team): Promise<AnimalWithSohibul[]> {
    const qb = this.animalRepo
      .createQueryBuilder('a')
      .where('a.eventId = :eventId', { eventId })
      .andWhere('a.scheduledAt IS NOT NULL');
    if (team) qb.andWhere('a.scheduledTeam = :team', { team });
    qb.orderBy('a.scheduledAt', 'ASC');
    const animals = await qb.getMany();

    return Promise.all(
      animals.map(async (animal) => ({
        animal,
        pengkurban: await this.sohibulOf(animal),
      })),
    );
  }

  /**
   * Eligible animals for scheduling in an event, with preferensi waktu attached.
   * Per spec §5 Input rules.
   */
  async loadEligibleAnimals(eventId: string): Promise<EligibleAnimal[]> {
    const formKey = process.env.KONFIRMASI_TEKNIS_FORM_KEY;
    const animals = await this.animalRepo.find({ where: { eventId } });

    const result: EligibleAnimal[] = [];
    for (const animal of animals) {
      if (animal.isVendorAnimal) {
        result.push({ animal, preferensi: null });
        continue;
      }
      if (animal.pengkurbanId) {
        const pk = await this.pengkurbanRepo.findOne({ where: { id: animal.pengkurbanId } });
        if (!pk || !['CONFIRMED', 'PENDING_VERIFICATION'].includes(pk.status)) continue;
        const preferensi = await this.preferensiForPengkurban(pk.id, formKey);
        result.push({ animal, preferensi });
      } else if (KOLEKTIF_TYPES.includes(animal.animalType)) {
        const eligible = await this.pengkurbanRepo.find({
          where: {
            eventId: animal.eventId,
            animalType: animal.animalType as any,
            status: In(['CONFIRMED', 'PENDING_VERIFICATION']) as any,
          },
        });
        if (eligible.length === 0) continue;
        const prefs = await Promise.all(
          eligible.map((pk) => this.preferensiForPengkurban(pk.id, formKey)),
        );
        const valid = prefs.filter((p): p is PreferensiTime => !!p);
        const earliest = valid.length
          ? valid.reduce((min, p) => (p.hour * 60 + p.minute < min.hour * 60 + min.minute ? p : min))
          : null;
        result.push({ animal, preferensi: earliest });
      }
      // else: ignore (unexpected non-vendor non-kolektif without pengkurban_id)
    }
    return result;
  }

  /**
   * PATCH single animal's schedule fields.
   */
  async updateSlot(
    animalId: string,
    patch: { scheduledAt?: Date | null; scheduledTeam?: Team | null; scheduledNote?: string | null },
  ): Promise<Animal> {
    await this.animalRepo.update(animalId, patch as any);
    const updated = await this.animalRepo.findOne({ where: { id: animalId } });
    if (!updated) throw new NotFoundException(`Animal ${animalId} not found`);
    return updated;
  }

  /**
   * Reset all schedule fields for animals in event.
   */
  async clearSchedule(eventId: string): Promise<{ cleared: number }> {
    const r = await this.animalRepo.update(
      { eventId },
      { scheduledAt: null, scheduledTeam: null, scheduledNote: null } as any,
    );
    return { cleared: r.affected ?? 0 };
  }

  /**
   * Return sohibul (pengkurban[]) for an animal. Individual: 1; kolektif: many; vendor: empty.
   */
  private async sohibulOf(animal: Animal): Promise<Pengkurban[]> {
    if (animal.isVendorAnimal) return [];
    if (animal.pengkurbanId) {
      const pk = await this.pengkurbanRepo.findOne({ where: { id: animal.pengkurbanId } });
      return pk ? [pk] : [];
    }
    if (KOLEKTIF_TYPES.includes(animal.animalType)) {
      return this.pengkurbanRepo.find({
        where: {
          eventId: animal.eventId,
          animalType: animal.animalType as any,
          status: In(['CONFIRMED', 'PENDING_VERIFICATION']) as any,
        },
        order: { createdAt: 'ASC' },
      });
    }
    return [];
  }

  private async preferensiForPengkurban(
    pengkurbanId: string,
    formKey: string | undefined,
  ): Promise<PreferensiTime | null> {
    if (!formKey) return null;
    const fr = await this.formRepo.findOne({ where: { pengkurbanId, formKey } });
    if (!fr) return null;
    const value = fr.data?.['Preferensi waktu penyembelihan'];
    return parsePreferensiTime(value);
  }
}
