import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, In } from 'typeorm';
import { Animal } from '../animals/animal.entity';
import { Pengkurban } from '../pengkurban/pengkurban.entity';
import { FormResponse } from '../form-responses/form-response.entity';
import { Event } from '../events/event.entity';
import { assignSlots, parsePreferensiTime, PreferensiTime } from './scheduling-mappers';
import { extractPermintaan, Permintaan } from './scheduling-mappers';

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

export interface GenerateSummary {
  generatedAt: string;
  teams: Record<Team, {
    total: number;
    slotsUsed: number;
    overflow: number;
    firstSlot: string | null;
    lastSlot: string | null;
  }>;
  mismatches: Array<{
    animalCode: string;
    pengkurbanName: string;
    preferred: string;
    scheduled: string;
    reason: string;
  }>;
  unscheduledWithoutPreferensi: Array<{
    animalCode: string;
    pengkurbanName: string;
  }>;
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
    @InjectRepository(Event)
    private readonly eventRepo: Repository<Event>,
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
   * Cheat sheet untuk tim jagal/seset: animals yang udah dijadwalkan, dengan
   * permintaan tiap sohibul. Individual = 1 sohibul; kolektif = many.
   */
  async getSesetData(
    eventId: string,
    team?: Team,
  ): Promise<Array<{
    animal: Animal;
    sohibulRequests: Array<{ name: string; phone: string | null } & Permintaan>;
  }>> {
    const formKey = process.env.KONFIRMASI_TEKNIS_FORM_KEY;
    const items = await this.getSchedule(eventId, team);

    return Promise.all(
      items.map(async ({ animal, pengkurban }) => {
        const sohibulRequests = await Promise.all(
          pengkurban.map(async (pk) => {
            const fr = formKey
              ? await this.formRepo.findOne({ where: { pengkurbanId: pk.id, formKey } })
              : null;
            const perm = extractPermintaan(fr?.data ?? null);
            return {
              name: pk.name,
              phone: pk.phone ?? null,
              ...perm,
            };
          }),
        );
        return { animal, sohibulRequests };
      }),
    );
  }

  /**
   * Eligible animals for scheduling in an event, with preferensi waktu attached.
   * Per spec §5 Input rules.
   */
  async loadEligibleAnimals(eventId: string): Promise<EligibleAnimal[]> {
    const formKey = process.env.KONFIRMASI_TEKNIS_FORM_KEY;
    const excludeRegs = new Set(
      (process.env.SCHEDULING_EXCLUDE_REGS || '')
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean),
    );
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
        if (excludeRegs.has(pk.registrationNumber)) continue;
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
        const eligibleNotExcluded = eligible.filter(
          (pk) => !excludeRegs.has(pk.registrationNumber),
        );
        if (eligibleNotExcluded.length === 0) continue;
        const prefs = await Promise.all(
          eligibleNotExcluded.map((pk) => this.preferensiForPengkurban(pk.id, formKey)),
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
    if (!fr || !fr.data) return null;
    // Prefix-match in case form admin renames or adds newlines to the column header
    const entry = Object.entries(fr.data).find(([k]) =>
      k.startsWith('Preferensi waktu penyembelihan'),
    );
    return parsePreferensiTime(entry ? entry[1] : null);
  }

  /**
   * Clear existing schedule for event, run algorithm per team, persist results.
   * Returns summary with per-team counts, mismatches, and unscheduled-without-preferensi list.
   */
  async generateSchedule(eventId: string): Promise<GenerateSummary> {
    const event = await this.eventRepo.findOne({ where: { id: eventId } });
    if (!event) throw new NotFoundException(`Event ${eventId} not found`);

    const eventDate = event.startDate ? new Date(event.startDate) : new Date();
    eventDate.setHours(0, 0, 0, 0);

    // Reset all schedule fields for this event first
    await this.animalRepo.update(
      { eventId },
      { scheduledAt: null, scheduledTeam: null } as any,
    );

    const eligible = await this.loadEligibleAnimals(eventId);

    const summary: GenerateSummary = {
      generatedAt: new Date().toISOString(),
      teams: {
        SAPI: { total: 0, slotsUsed: 0, overflow: 0, firstSlot: null, lastSlot: null },
        KAMBING_DOMBA: { total: 0, slotsUsed: 0, overflow: 0, firstSlot: null, lastSlot: null },
      },
      mismatches: [],
      unscheduledWithoutPreferensi: [],
    };

    for (const team of ['SAPI', 'KAMBING_DOMBA'] as Team[]) {
      const teamAnimals = eligible.filter((e) => teamOf(e.animal.animalType) === team);
      const inputs = teamAnimals.map((e) => ({
        id: e.animal.id,
        preferensi: e.preferensi,
        payload: e.animal,
      }));
      const assignments = assignSlots(inputs, eventDate);

      for (const a of assignments) {
        await this.animalRepo.update(a.id, {
          scheduledAt: a.slotStart,
          scheduledTeam: team,
        } as any);
      }

      summary.teams[team].total = teamAnimals.length;
      summary.teams[team].slotsUsed = assignments.length;
      if (assignments.length > 0) {
        const first = assignments[0].slotStart;
        const last = assignments[assignments.length - 1].slotStart;
        const fmt = (d: Date) =>
          `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
        summary.teams[team].firstSlot = fmt(first);
        summary.teams[team].lastSlot = fmt(last);
        const overflowCutoff = new Date(eventDate);
        overflowCutoff.setHours(12, 0, 0, 0);
        summary.teams[team].overflow = assignments.filter(
          (a) => a.slotStart.getTime() >= overflowCutoff.getTime(),
        ).length;
      }

      for (const a of assignments) {
        const e = teamAnimals.find((te) => te.animal.id === a.id)!;
        if (a.mismatch) {
          const sohibul = await this.firstSohibulName(e.animal);
          summary.mismatches.push({
            animalCode: e.animal.animalCode,
            pengkurbanName: sohibul,
            preferred: a.mismatch.preferred,
            scheduled: a.mismatch.scheduled,
            reason: a.mismatch.reason,
          });
        } else if (!e.preferensi && !e.animal.isVendorAnimal) {
          const sohibul = await this.firstSohibulName(e.animal);
          summary.unscheduledWithoutPreferensi.push({
            animalCode: e.animal.animalCode,
            pengkurbanName: sohibul,
          });
        }
      }
    }

    return summary;
  }

  /**
   * Get ops data for one team: current (IN_PROGRESS), next 3 (WAITING), recent 5 (DONE).
   */
  async getOpsData(eventId: string, team: Team): Promise<{
    current: AnimalWithSohibul[];
    next: AnimalWithSohibul[];
    recent: AnimalWithSohibul[];
    waitingCount: number;
    doneCount: number;
  }> {
    const all = await this.animalRepo.find({
      where: { eventId, scheduledTeam: team as any },
      order: { scheduledAt: 'ASC' },
    });
    const enrich = async (animals: Animal[]) =>
      Promise.all(animals.map(async (animal) => ({
        animal,
        pengkurban: await this.sohibulOf(animal),
      })));
    const current = await enrich(all.filter((a) => a.slaughterStatus === 'IN_PROGRESS'));
    const waiting = all.filter((a) => a.slaughterStatus === 'WAITING');
    // Show top 10 WAITING (urutan field bisa beda dari jadwal — panitia bisa Mulai mana saja)
    const next = await enrich(waiting.slice(0, 10));
    const recent = await enrich(
      all.filter((a) => a.slaughterStatus === 'DONE' || a.slaughterStatus === 'SKIPPED')
        .sort((a, b) => (b.slaughterDoneAt?.getTime() ?? 0) - (a.slaughterDoneAt?.getTime() ?? 0))
        .slice(0, 5),
    );
    return {
      current,
      next,
      recent,
      waitingCount: waiting.length,
      doneCount: all.filter((a) => a.slaughterStatus === 'DONE').length,
    };
  }

  /**
   * Transition: WAITING → IN_PROGRESS. Returns nextWaitingAnimalId for JIT WA hook.
   */
  async startAnimal(animalId: string): Promise<{ animal: Animal; nextWaitingId: string | null }> {
    const animal = await this.animalRepo.findOne({ where: { id: animalId } });
    if (!animal) throw new NotFoundException(`Animal ${animalId} not found`);
    await this.animalRepo.update(animalId, {
      slaughterStatus: 'IN_PROGRESS' as any,
      slaughterStartedAt: new Date(),
    } as any);
    let nextWaitingId: string | null = null;
    if (animal.scheduledTeam) {
      const next = await this.animalRepo.findOne({
        where: {
          eventId: animal.eventId,
          scheduledTeam: animal.scheduledTeam as any,
          slaughterStatus: 'WAITING' as any,
        },
        order: { scheduledAt: 'ASC' },
      });
      nextWaitingId = next?.id ?? null;
    }
    const updated = await this.animalRepo.findOne({ where: { id: animalId } });
    return { animal: updated!, nextWaitingId };
  }

  /**
   * Transition: → DONE.
   */
  async doneAnimal(animalId: string): Promise<Animal> {
    const animal = await this.animalRepo.findOne({ where: { id: animalId } });
    if (!animal) throw new NotFoundException(`Animal ${animalId} not found`);
    await this.animalRepo.update(animalId, {
      slaughterStatus: 'DONE' as any,
      slaughterDoneAt: new Date(),
    } as any);
    return (await this.animalRepo.findOne({ where: { id: animalId } }))!;
  }

  /**
   * Transition: → SKIPPED (manual override, treated like done but flagged).
   */
  async skipAnimal(animalId: string): Promise<Animal> {
    const animal = await this.animalRepo.findOne({ where: { id: animalId } });
    if (!animal) throw new NotFoundException(`Animal ${animalId} not found`);
    await this.animalRepo.update(animalId, {
      slaughterStatus: 'SKIPPED' as any,
      slaughterDoneAt: new Date(),
    } as any);
    return (await this.animalRepo.findOne({ where: { id: animalId } }))!;
  }

  /**
   * Reset slaughter status to WAITING (e.g. accidental mark-done revert).
   */
  async resetAnimalStatus(animalId: string): Promise<Animal> {
    await this.animalRepo.update(animalId, {
      slaughterStatus: 'WAITING' as any,
      slaughterStartedAt: null,
      slaughterDoneAt: null,
    } as any);
    return (await this.animalRepo.findOne({ where: { id: animalId } }))!;
  }

  /** Public so controller can fetch by id. */
  async findAnimal(animalId: string): Promise<Animal | null> {
    return this.animalRepo.findOne({ where: { id: animalId } });
  }

  /**
   * Find sohibul phones for an animal that have hadir=true (JIT recipient).
   * Reads form data for kehadiran field.
   */
  async hadirSohibulPhones(animal: Animal): Promise<Array<{ name: string; phone: string }>> {
    const pks = await this.sohibulOf(animal);
    const formKey = process.env.KONFIRMASI_TEKNIS_FORM_KEY;
    const result: Array<{ name: string; phone: string }> = [];
    for (const pk of pks) {
      if (!pk.phone) continue;
      if (!formKey) {
        result.push({ name: pk.name, phone: pk.phone });
        continue;
      }
      const fr = await this.formRepo.findOne({ where: { pengkurbanId: pk.id, formKey } });
      if (!fr || !fr.data) continue;
      const kehadiranEntry = Object.entries(fr.data).find(([k]) =>
        k.startsWith('Kehadiran saat penyembelihan'),
      );
      const kehadiran = kehadiranEntry ? String(kehadiranEntry[1]) : '';
      if (/hadir langsung/i.test(kehadiran)) {
        result.push({ name: pk.name, phone: pk.phone });
      }
    }
    return result;
  }

  /**
   * Find sohibul phones for an animal that have hadir=false (auto-broadcast foto target).
   */
  async tidakHadirSohibulPhones(animal: Animal): Promise<Array<{ name: string; phone: string }>> {
    const pks = await this.sohibulOf(animal);
    const formKey = process.env.KONFIRMASI_TEKNIS_FORM_KEY;
    const result: Array<{ name: string; phone: string }> = [];
    for (const pk of pks) {
      if (!pk.phone) continue;
      if (!formKey) continue;
      const fr = await this.formRepo.findOne({ where: { pengkurbanId: pk.id, formKey } });
      if (!fr || !fr.data) continue;
      const kehadiranEntry = Object.entries(fr.data).find(([k]) =>
        k.startsWith('Kehadiran saat penyembelihan'),
      );
      const kehadiran = kehadiranEntry ? String(kehadiranEntry[1]) : '';
      if (/tidak bisa hadir/i.test(kehadiran)) {
        result.push({ name: pk.name, phone: pk.phone });
      }
    }
    return result;
  }

  private async firstSohibulName(animal: Animal): Promise<string> {
    if (animal.pengkurbanId) {
      const pk = await this.pengkurbanRepo.findOne({ where: { id: animal.pengkurbanId } });
      return pk?.name ?? '(unknown)';
    }
    if (KOLEKTIF_TYPES.includes(animal.animalType)) {
      const pk = await this.pengkurbanRepo.findOne({
        where: {
          eventId: animal.eventId,
          animalType: animal.animalType as any,
          status: In(['CONFIRMED', 'PENDING_VERIFICATION']) as any,
        },
        order: { createdAt: 'ASC' },
      });
      return pk?.name ?? '(kolektif)';
    }
    return '(vendor)';
  }
}
