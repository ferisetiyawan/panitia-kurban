# Jadwal Penyembelihan Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bangun fitur Phase 1 jadwal penyembelihan: generator algoritma + admin UI + PDF + WA broadcast ke grup + section "Jadwal Anda" di portal sohibul.

**Architecture:** Module baru `src/scheduling/`. Extend tabel `animals` dengan `scheduled_at`, `scheduled_team`, `scheduled_note` (1:1 — no separate table). Algoritma greedy assignment per tim (SAPI, KAMBING_DOMBA) ke slot 15-mnt mulai 07:30, soft-honor preferensi dari form responses. Frontend vanilla HTML + Tailwind CDN sesuai pola existing. Broadcast WA ke grup via wa-bot `/send` (bukan loop per-nomor) untuk hindari ban risk.

**Tech Stack:** NestJS 10 + TypeORM + PostgreSQL (Neon), pdfkit, vanilla JS frontend, wa-bot HTTP integration.

**Spec reference:** `docs/superpowers/specs/2026-05-26-jadwal-penyembelihan-design.md`

---

## Pre-flight Checks

### Task 1: Verify wa-bot supports group JID via /send

**Files:**
- Read: `/Users/fajarfirdaus/Development/wa-bot/` (different repo, just verify)

- [ ] **Step 1: Inspect wa-bot /send handler**

Check `wa-bot/server.js` or equivalent for `/send` endpoint — does it accept Baileys group JID format `<id>@g.us` as recipient?

Run: `grep -n "@g.us\|jid\|chatId" /Users/fajarfirdaus/Development/wa-bot/server.js`

Expected: see code accepting JID directly (Baileys sock.sendMessage accepts both `<phone>@s.whatsapp.net` and `<id>@g.us`).

- [ ] **Step 2: Test send to dummy group (or own phone fallback)**

If wa-bot accepts JID directly, no change needed. If endpoint hardcodes `@s.whatsapp.net`, add task to wa-bot repo (out of scope here — flag to user). Document finding.

For testing: ambil JID grup sohibul qurban kalau wa-bot udah di-invite. Kalau belum, user perlu invite dulu dan kasih JID-nya. Verify dengan:

```bash
curl -s -X POST -H "x-api-key: $WA_BOT_API_KEY" -H "content-type: application/json" \
  -d '{"jid":"<group-id>@g.us","message":"test scheduling broadcast"}' \
  $WA_BOT_URL/send
```

Expected: 200 + message muncul di grup.

- [ ] **Step 3: Record findings**

Tulis 1 paragraf di `docs/superpowers/plans/2026-05-26-jadwal-penyembelihan.md` bagian bawah "Pre-flight findings" (atau di issue tracker) berisi: apakah wa-bot support, JID grup sohibul + panitia (kalau ada), atau blocker yang perlu di-fix di wa-bot dulu.

### Task 2: Apply migration SQL to Neon

**Files:**
- Reference: `docs/superpowers/specs/2026-05-26-jadwal-penyembelihan-design.md` §4

- [ ] **Step 1: Connect to Neon DB**

```bash
cd /Users/fajarfirdaus/Development/wa-bot
source .env
psql "postgres://$DB_USER:$DB_PASSWORD@$DB_HOST:$DB_PORT/$DB_NAME?sslmode=require"
```

- [ ] **Step 2: Run migration**

```sql
ALTER TABLE animals
  ADD COLUMN scheduled_at TIMESTAMPTZ NULL,
  ADD COLUMN scheduled_team VARCHAR(20) NULL,
  ADD COLUMN scheduled_note TEXT NULL,
  ADD CONSTRAINT chk_animals_scheduled_team
    CHECK (scheduled_team IS NULL OR scheduled_team IN ('SAPI','KAMBING_DOMBA'));

CREATE INDEX idx_animals_scheduled_at
  ON animals (scheduled_at) WHERE scheduled_at IS NOT NULL;

CREATE INDEX idx_animals_scheduled_team_at
  ON animals (scheduled_team, scheduled_at);
```

- [ ] **Step 3: Verify**

```sql
\d animals
```

Expected: 3 kolom baru muncul, 2 index baru muncul.

- [ ] **Step 4: Exit psql, log success**

`\q`

No commit needed — migration berlaku di prod DB. Lokal dev pakai `synchronize: true` jadi akan auto-create.

---

## Backend: Entity, Mappers, Module Scaffold

### Task 3: Extend Animal entity

**Files:**
- Modify: `src/animals/animal.entity.ts`

- [ ] **Step 1: Add 3 columns to Animal entity**

Append after existing columns (sebelum class closing brace):

```typescript
  @Column({ name: 'scheduled_at', type: 'timestamptz', nullable: true })
  scheduledAt: Date | null;

  @Column({ name: 'scheduled_team', type: 'varchar', length: 20, nullable: true })
  scheduledTeam: 'SAPI' | 'KAMBING_DOMBA' | null;

  @Column({ name: 'scheduled_note', type: 'text', nullable: true })
  scheduledNote: string | null;
```

- [ ] **Step 2: Verify build clean**

Run: `npm run build`

Expected: no errors. Local dev `synchronize: true` akan apply column saat boot berikutnya.

- [ ] **Step 3: Commit**

```bash
git add src/animals/animal.entity.ts
git commit -m "feat(animals): add scheduled_at/team/note columns for jadwal penyembelihan"
```

### Task 4: Scaffold scheduling module directory

**Files:**
- Create: `src/scheduling/scheduling.module.ts` (placeholder)

- [ ] **Step 1: Create empty module file**

`src/scheduling/scheduling.module.ts`:
```typescript
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Animal } from '../animals/animal.entity';
import { Pengkurban } from '../pengkurban/pengkurban.entity';
import { FormResponse } from '../form-responses/form-response.entity';
import { NotificationsModule } from '../common/notifications/notifications.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([Animal, Pengkurban, FormResponse]),
    NotificationsModule,
  ],
  providers: [],
  controllers: [],
  exports: [],
})
export class SchedulingModule {}
```

- [ ] **Step 2: Register in app.module.ts**

Modify `src/app.module.ts`: import + add to `imports` array.

```typescript
// at top of file with other imports
import { SchedulingModule } from './scheduling/scheduling.module';

// in @Module imports array (after FormResponsesModule)
SchedulingModule,
```

- [ ] **Step 3: Build clean**

Run: `npm run build`

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/scheduling/scheduling.module.ts src/app.module.ts
git commit -m "feat(scheduling): scaffold module"
```

### Task 5: Implement parsePreferensiTime mapper (TDD)

**Files:**
- Create: `src/scheduling/scheduling-mappers.ts`
- Create: `src/scheduling/scheduling-mappers.spec.ts`

- [ ] **Step 1: Write failing tests**

`src/scheduling/scheduling-mappers.spec.ts`:
```typescript
import { parsePreferensiTime } from './scheduling-mappers';

describe('parsePreferensiTime', () => {
  it.each([
    ['Jam 07.00 sd.07.30', { hour: 7, minute: 0 }],
    ['Jam 07.30 sd 08.00', { hour: 7, minute: 30 }],
    ['Jam 08.30 sd 09.00', { hour: 8, minute: 30 }],
    ['Jam 12.00 sd 12.30', { hour: 12, minute: 0 }],
    ['Jam 7.0 sd 7.30', { hour: 7, minute: 0 }],  // tolerate single-digit hour, 1-digit minute pad zero — but our regex requires 2-digit minute; this should fail. Adjust expectations:
  ])('parses %j', (input, expected) => {
    expect(parsePreferensiTime(input as string)).toEqual(expected);
  });

  it.each([
    ['', null],
    [null, null],
    [undefined, null],
    ['jam invalid', null],
    ['Jam 25.00 sd 25.30', null],
    ['Jam ab.cd sd ef.gh', null],
  ])('returns null for %j', (input, expected) => {
    expect(parsePreferensiTime(input as any)).toEqual(expected);
  });
});
```

Note: the `'Jam 7.0 sd 7.30'` case should be removed — regex requires `\d{2}` for minutes. Remove that row.

Final test list:
```typescript
it.each([
  ['Jam 07.00 sd.07.30', { hour: 7, minute: 0 }],
  ['Jam 07.30 sd 08.00', { hour: 7, minute: 30 }],
  ['Jam 08.30 sd 09.00', { hour: 8, minute: 30 }],
  ['Jam 12.00 sd 12.30', { hour: 12, minute: 0 }],
])('parses %j', (input, expected) => {
  expect(parsePreferensiTime(input as string)).toEqual(expected);
});
```

- [ ] **Step 2: Run test, expect fail**

Run: `npx jest src/scheduling/scheduling-mappers.spec.ts`

Expected: FAIL with "Cannot find module './scheduling-mappers'"

- [ ] **Step 3: Implement mapper**

`src/scheduling/scheduling-mappers.ts`:
```typescript
export interface PreferensiTime {
  hour: number;
  minute: number;
}

export function parsePreferensiTime(
  value: string | null | undefined,
): PreferensiTime | null {
  if (!value) return null;
  const match = value.match(/Jam\s+(\d{1,2})[.:](\d{2})/);
  if (!match) return null;
  const hour = parseInt(match[1], 10);
  const minute = parseInt(match[2], 10);
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return null;
  return { hour, minute };
}
```

- [ ] **Step 4: Run test, expect pass**

Run: `npx jest src/scheduling/scheduling-mappers.spec.ts`

Expected: PASS (10 tests).

- [ ] **Step 5: Commit**

```bash
git add src/scheduling/scheduling-mappers.ts src/scheduling/scheduling-mappers.spec.ts
git commit -m "feat(scheduling): parsePreferensiTime mapper + tests"
```

---

## Backend: Service (algorithm + queries)

### Task 6: Service skeleton + getSchedule query (read)

**Files:**
- Create: `src/scheduling/scheduling.service.ts`

- [ ] **Step 1: Implement service skeleton with getSchedule**

`src/scheduling/scheduling.service.ts`:
```typescript
import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, In, IsNull, Not } from 'typeorm';
import { Animal } from '../animals/animal.entity';
import { Pengkurban } from '../pengkurban/pengkurban.entity';
import { FormResponse } from '../form-responses/form-response.entity';

export type Team = 'SAPI' | 'KAMBING_DOMBA';

const KOLEKTIF_TYPES = ['SAPI_KOLEKTIF_A', 'SAPI_KOLEKTIF_B', 'SAPI_KOLEKTIF_C'];
const SAPI_TYPES = [...KOLEKTIF_TYPES, 'SAPI_PERORANGAN'];

export function teamOf(animalType: string): Team {
  if (SAPI_TYPES.includes(animalType)) return 'SAPI';
  return 'KAMBING_DOMBA';
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

  async getSchedule(
    eventId: string,
    team?: Team,
  ): Promise<Array<{ animal: Animal; pengkurban: Pengkurban[] }>> {
    const qb = this.animalRepo
      .createQueryBuilder('a')
      .where('a.eventId = :eventId', { eventId })
      .andWhere('a.scheduledAt IS NOT NULL');
    if (team) qb.andWhere('a.scheduledTeam = :team', { team });
    qb.orderBy('a.scheduledAt', 'ASC');
    const animals = await qb.getMany();

    // Attach sohibul info — individual: 1 pengkurban; kolektif: many
    return Promise.all(
      animals.map(async (animal) => {
        let pengkurban: Pengkurban[];
        if (animal.pengkurbanId) {
          const pk = await this.pengkurbanRepo.findOne({
            where: { id: animal.pengkurbanId },
          });
          pengkurban = pk ? [pk] : [];
        } else if (KOLEKTIF_TYPES.includes(animal.animalType)) {
          pengkurban = await this.pengkurbanRepo.find({
            where: {
              eventId: animal.eventId,
              animalType: animal.animalType as any,
              status: In(['CONFIRMED', 'PENDING_VERIFICATION']) as any,
            },
          });
        } else {
          pengkurban = [];
        }
        return { animal, pengkurban };
      }),
    );
  }
}
```

- [ ] **Step 2: Register service in module**

Modify `src/scheduling/scheduling.module.ts`:
```typescript
import { SchedulingService } from './scheduling.service';

@Module({
  // ...
  providers: [SchedulingService],
  exports: [SchedulingService],
})
```

- [ ] **Step 3: Build clean**

Run: `npm run build`

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/scheduling/scheduling.service.ts src/scheduling/scheduling.module.ts
git commit -m "feat(scheduling): service skeleton + getSchedule"
```

### Task 7: Helper — loadEligibleAnimals (with preferensi attached)

**Files:**
- Modify: `src/scheduling/scheduling.service.ts`

- [ ] **Step 1: Add method `loadEligibleAnimals`**

Append in `SchedulingService` class:

```typescript
  /**
   * Animals eligible for scheduling in an event, with preferensi waktu attached.
   * Per spec §5 Input:
   *   - Individual (pengkurbanId not null): pengkurban must be CONFIRMED/PENDING_VERIFICATION, not deleted
   *   - Kolektif (animal_type=SAPI_KOLEKTIF_*): include if >=1 eligible pengkurban exists
   *   - Vendor (isVendorAnimal): always include, no preferensi
   */
  async loadEligibleAnimals(eventId: string): Promise<
    Array<{ animal: Animal; preferensi: { hour: number; minute: number } | null }>
  > {
    const formKey = process.env.KONFIRMASI_TEKNIS_FORM_KEY;

    const animals = await this.animalRepo.find({
      where: { eventId },
    });

    const result: Array<{ animal: Animal; preferensi: any }> = [];
    for (const animal of animals) {
      if (animal.isVendorAnimal) {
        result.push({ animal, preferensi: null });
        continue;
      }
      if (animal.pengkurbanId) {
        // Individual
        const pk = await this.pengkurbanRepo.findOne({
          where: { id: animal.pengkurbanId },
        });
        if (!pk || pk.deletedAt || !['CONFIRMED', 'PENDING_VERIFICATION'].includes(pk.status)) {
          continue;
        }
        const preferensi = await this.preferensiForPengkurban(pk.id, formKey);
        result.push({ animal, preferensi });
      } else if (KOLEKTIF_TYPES.includes(animal.animalType)) {
        // Kolektif: any eligible pengkurban?
        const eligible = await this.pengkurbanRepo.find({
          where: {
            eventId: animal.eventId,
            animalType: animal.animalType as any,
            status: In(['CONFIRMED', 'PENDING_VERIFICATION']) as any,
          },
        });
        if (eligible.length === 0) continue;
        // Earliest preferensi across all sohibul of this kolektif
        const allPrefs = await Promise.all(
          eligible.map((pk) => this.preferensiForPengkurban(pk.id, formKey)),
        );
        const valid = allPrefs.filter((p): p is { hour: number; minute: number } => !!p);
        const earliest = valid.length
          ? valid.reduce((min, p) =>
              p.hour * 60 + p.minute < min.hour * 60 + min.minute ? p : min,
            )
          : null;
        result.push({ animal, preferensi: earliest });
      }
      // else: skip — non-vendor, non-kolektif, no pengkurban_id (unexpected, log)
    }
    return result;
  }

  private async preferensiForPengkurban(
    pengkurbanId: string,
    formKey: string | undefined,
  ): Promise<{ hour: number; minute: number } | null> {
    if (!formKey) return null;
    const fr = await this.formRepo.findOne({
      where: { pengkurbanId, formKey },
    });
    if (!fr) return null;
    const value = fr.data?.['Preferensi waktu penyembelihan'];
    const { parsePreferensiTime } = await import('./scheduling-mappers');
    return parsePreferensiTime(value);
  }
```

- [ ] **Step 2: Build clean**

Run: `npm run build`

Expected: no errors. (Note: `pk.deletedAt` access — verify Pengkurban entity exposes this. If not, check via `withDeleted: true` + check the field. Pengkurban uses `@DeleteDateColumn deletedAt`, so default queries already exclude deleted — `deletedAt` check redundant when querying without `withDeleted: true`. Simplify if needed.)

- [ ] **Step 3: Commit**

```bash
git add src/scheduling/scheduling.service.ts
git commit -m "feat(scheduling): loadEligibleAnimals helper with preferensi aggregation"
```

### Task 8: Algorithm — assignSlots (pure function, TDD)

**Files:**
- Modify: `src/scheduling/scheduling-mappers.ts` (add `assignSlots`)
- Modify: `src/scheduling/scheduling-mappers.spec.ts`

- [ ] **Step 1: Write tests for assignSlots**

Append to `scheduling-mappers.spec.ts`:

```typescript
import { assignSlots, PreferensiTime } from './scheduling-mappers';

describe('assignSlots', () => {
  const eventDate = new Date('2026-06-06T00:00:00+07:00'); // 00:00 WIB Idul Adha

  function input(
    items: Array<{ id: string; pref?: PreferensiTime | null }>,
  ): Array<{ id: string; preferensi: PreferensiTime | null }> {
    return items.map((i) => ({ id: i.id, preferensi: i.pref ?? null }));
  }

  it('returns empty slots when no animals', () => {
    expect(assignSlots([], eventDate)).toEqual([]);
  });

  it('assigns single animal preferring 07:00 to slot 07:30', () => {
    const slots = assignSlots(input([{ id: 'A', pref: { hour: 7, minute: 0 } }]), eventDate);
    expect(slots).toHaveLength(1);
    expect(slots[0].id).toBe('A');
    expect(slots[0].slotStart.getHours()).toBe(7);
    expect(slots[0].slotStart.getMinutes()).toBe(30);
  });

  it('honors preferensi 08:30 to slot 08:30', () => {
    const slots = assignSlots(
      input([{ id: 'A', pref: { hour: 8, minute: 30 } }]),
      eventDate,
    );
    expect(slots[0].slotStart.getHours()).toBe(8);
    expect(slots[0].slotStart.getMinutes()).toBe(30);
    expect(slots[0].mismatch).toBeUndefined();
  });

  it('fills FLEX animals to earliest empty slots', () => {
    const slots = assignSlots(
      input([{ id: 'A' }, { id: 'B' }]),
      eventDate,
    );
    expect(slots[0].id).toBe('A');
    expect(slots[0].slotStart.getHours()).toBe(7);
    expect(slots[0].slotStart.getMinutes()).toBe(30);
    expect(slots[1].id).toBe('B');
    expect(slots[1].slotStart.getHours()).toBe(7);
    expect(slots[1].slotStart.getMinutes()).toBe(45);
  });

  it('places A=07:30 and B (same pref 07:00) to next slot 07:45', () => {
    const slots = assignSlots(
      input([
        { id: 'A', pref: { hour: 7, minute: 0 } },
        { id: 'B', pref: { hour: 7, minute: 0 } },
      ]),
      eventDate,
    );
    const byId = (id: string) => slots.find((s) => s.id === id)!;
    expect(byId('A').slotStart.getMinutes()).toBe(30);
    expect(byId('B').slotStart.getMinutes()).toBe(45);
  });

  it('extends slot grid when animals exceed 18 default slots', () => {
    const many = input(
      Array.from({ length: 20 }, (_, i) => ({ id: `A${i}` })),
    );
    const slots = assignSlots(many, eventDate);
    expect(slots).toHaveLength(20);
    const last = slots[slots.length - 1].slotStart;
    expect(last.getHours()).toBe(12);
    expect(last.getMinutes()).toBe(15);
  });

  it('flags mismatch when preferensi not honored', () => {
    // 19 animals all preferring 07:00 — only 1 fits at 07:30, rest pushed later
    const many = input(
      Array.from({ length: 19 }, (_, i) => ({
        id: `A${i}`,
        pref: { hour: 7, minute: 0 },
      })),
    );
    const slots = assignSlots(many, eventDate);
    expect(slots[0].mismatch).toBeUndefined();
    // Animal pushed to ≥08:30 (1.5 hr later) considered mismatched
    const lateOnes = slots.filter((s) => s.mismatch);
    expect(lateOnes.length).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run test, expect fail**

Run: `npx jest src/scheduling/scheduling-mappers.spec.ts`

Expected: FAIL "assignSlots is not exported".

- [ ] **Step 3: Implement assignSlots**

Append to `src/scheduling/scheduling-mappers.ts`:

```typescript
export interface SlotAssignment<T> {
  id: string; // animal id pass-through (so caller can persist)
  payload: T;
  slotStart: Date;
  mismatch?: { preferred: string; scheduled: string; reason: string };
}

interface SchedulableInput<T = unknown> {
  id: string;
  preferensi: PreferensiTime | null;
  payload?: T;
}

const DEFAULT_SLOTS = 18;
const SLOT_MINUTES = 15;
const START_HOUR = 7;
const START_MINUTE = 30;
const MISMATCH_THRESHOLD_MINUTES = 60; // > 1 hour off preferensi flagged

export function assignSlots<T = unknown>(
  inputs: SchedulableInput<T>[],
  eventDate: Date,
): SlotAssignment<T>[] {
  if (inputs.length === 0) return [];

  // Build initial slot grid (slotStart timestamps, all empty)
  const slots: Array<{ start: Date; taken: SchedulableInput<T> | null }> = [];
  const base = new Date(eventDate);
  base.setHours(START_HOUR, START_MINUTE, 0, 0);
  for (let i = 0; i < DEFAULT_SLOTS; i++) {
    slots.push({
      start: new Date(base.getTime() + i * SLOT_MINUTES * 60 * 1000),
      taken: null,
    });
  }

  // Group inputs by bucket
  const bucketed = new Map<string, SchedulableInput<T>[]>();
  const flex: SchedulableInput<T>[] = [];
  for (const inp of inputs) {
    if (!inp.preferensi) {
      flex.push(inp);
      continue;
    }
    const key = `${String(inp.preferensi.hour).padStart(2, '0')}:${String(inp.preferensi.minute).padStart(2, '0')}`;
    if (!bucketed.has(key)) bucketed.set(key, []);
    bucketed.get(key)!.push(inp);
  }

  // Sort bucket keys ascending
  const sortedKeys = [...bucketed.keys()].sort();

  function ensureSlot(targetTime: Date | null): {
    start: Date;
    taken: SchedulableInput<T> | null;
  } {
    if (targetTime) {
      // Find empty slot >= target first
      let chosen = slots.find((s) => !s.taken && s.start.getTime() >= targetTime.getTime());
      if (chosen) return chosen;
      // Fallback: latest empty slot < target
      const earlier = [...slots]
        .filter((s) => !s.taken && s.start.getTime() < targetTime.getTime())
        .sort((a, b) => b.start.getTime() - a.start.getTime());
      if (earlier.length > 0) return earlier[0];
    } else {
      // FLEX: first empty slot
      const chosen = slots.find((s) => !s.taken);
      if (chosen) return chosen;
    }
    // Extend grid
    const last = slots[slots.length - 1];
    const next = {
      start: new Date(last.start.getTime() + SLOT_MINUTES * 60 * 1000),
      taken: null as SchedulableInput<T> | null,
    };
    slots.push(next);
    return next;
  }

  for (const key of sortedKeys) {
    const bucketAnimals = bucketed.get(key)!;
    const [hour, minute] = key.split(':').map(Number);
    const target = new Date(eventDate);
    target.setHours(hour, minute, 0, 0);
    for (const inp of bucketAnimals) {
      const slot = ensureSlot(target);
      slot.taken = inp;
    }
  }

  for (const inp of flex) {
    const slot = ensureSlot(null);
    slot.taken = inp;
  }

  // Build result with mismatch detection
  return slots
    .filter((s) => s.taken !== null)
    .map((s) => {
      const taken = s.taken!;
      const result: SlotAssignment<T> = {
        id: taken.id,
        payload: taken.payload as T,
        slotStart: s.start,
      };
      if (taken.preferensi) {
        const target = taken.preferensi.hour * 60 + taken.preferensi.minute;
        const actual = s.start.getHours() * 60 + s.start.getMinutes();
        const diff = Math.abs(actual - target);
        if (diff > MISMATCH_THRESHOLD_MINUTES) {
          result.mismatch = {
            preferred: `${String(taken.preferensi.hour).padStart(2, '0')}:${String(taken.preferensi.minute).padStart(2, '0')}`,
            scheduled: `${String(s.start.getHours()).padStart(2, '0')}:${String(s.start.getMinutes()).padStart(2, '0')}`,
            reason: 'slot terdekat penuh',
          };
        }
      }
      return result;
    });
}
```

- [ ] **Step 4: Run tests, expect pass**

Run: `npx jest src/scheduling/scheduling-mappers.spec.ts`

Expected: all pass. If a test fails, adjust expectations — the implementation is the source of truth for behavior; iterate until tests + impl agree on correct behavior per spec §5.

- [ ] **Step 5: Commit**

```bash
git add src/scheduling/scheduling-mappers.ts src/scheduling/scheduling-mappers.spec.ts
git commit -m "feat(scheduling): assignSlots greedy algorithm + tests"
```

### Task 9: Service — generateSchedule (wire algorithm to DB)

**Files:**
- Modify: `src/scheduling/scheduling.service.ts`

- [ ] **Step 1: Add generateSchedule method**

```typescript
import { assignSlots, SlotAssignment } from './scheduling-mappers';

// add inside SchedulingService class:

  async generateSchedule(eventId: string): Promise<{
    generatedAt: string;
    teams: Record<Team, { total: number; slotsUsed: number; overflow: number; firstSlot: string | null; lastSlot: string | null }>;
    mismatches: Array<{ animalCode: string; pengkurbanName: string; preferred: string; scheduled: string; reason: string }>;
    unscheduledWithoutPreferensi: Array<{ animalCode: string; pengkurbanName: string }>;
  }> {
    const event = await this.animalRepo.manager
      .createQueryBuilder()
      .select('e')
      .from('events', 'e')
      .where('e.id = :id', { id: eventId })
      .getRawOne();
    if (!event) throw new Error(`Event ${eventId} not found`);

    // Event date: assume Idul Adha date stored on event. If not, fallback to today.
    const eventDate = event.e_event_date
      ? new Date(event.e_event_date)
      : new Date();
    eventDate.setHours(0, 0, 0, 0);

    const eligible = await this.loadEligibleAnimals(eventId);

    // Reset all animals in event first
    await this.animalRepo.update(
      { eventId },
      { scheduledAt: null, scheduledTeam: null },
    );

    const result = {
      generatedAt: new Date().toISOString(),
      teams: {
        SAPI: { total: 0, slotsUsed: 0, overflow: 0, firstSlot: null as string | null, lastSlot: null as string | null },
        KAMBING_DOMBA: { total: 0, slotsUsed: 0, overflow: 0, firstSlot: null as string | null, lastSlot: null as string | null },
      } as Record<Team, any>,
      mismatches: [] as any[],
      unscheduledWithoutPreferensi: [] as any[],
    };

    // Per-team assignment
    for (const team of ['SAPI', 'KAMBING_DOMBA'] as Team[]) {
      const teamAnimals = eligible.filter(
        (e) => teamOf(e.animal.animalType) === team,
      );
      const inputs = teamAnimals.map((e) => ({
        id: e.animal.id,
        preferensi: e.preferensi,
        payload: e.animal,
      }));
      const assignments = assignSlots(inputs, eventDate);

      // Persist
      for (const a of assignments) {
        await this.animalRepo.update(a.id, {
          scheduledAt: a.slotStart,
          scheduledTeam: team,
        });
      }

      result.teams[team].total = teamAnimals.length;
      result.teams[team].slotsUsed = assignments.length;
      if (assignments.length > 0) {
        const first = assignments[0].slotStart;
        const last = assignments[assignments.length - 1].slotStart;
        result.teams[team].firstSlot = `${String(first.getHours()).padStart(2, '0')}:${String(first.getMinutes()).padStart(2, '0')}`;
        result.teams[team].lastSlot = `${String(last.getHours()).padStart(2, '0')}:${String(last.getMinutes()).padStart(2, '0')}`;
        const overflowCutoff = new Date(eventDate);
        overflowCutoff.setHours(12, 0, 0, 0);
        result.teams[team].overflow = assignments.filter(
          (a) => a.slotStart.getTime() >= overflowCutoff.getTime(),
        ).length;
      }

      // Mismatches + unscheduled tracking
      for (const a of assignments) {
        const e = teamAnimals.find((te) => te.animal.id === a.id)!;
        if (a.mismatch) {
          const sohibul = await this.firstSohibulName(e.animal);
          result.mismatches.push({
            animalCode: e.animal.animalCode,
            pengkurbanName: sohibul,
            preferred: a.mismatch.preferred,
            scheduled: a.mismatch.scheduled,
            reason: a.mismatch.reason,
          });
        } else if (!e.preferensi && !e.animal.isVendorAnimal) {
          const sohibul = await this.firstSohibulName(e.animal);
          result.unscheduledWithoutPreferensi.push({
            animalCode: e.animal.animalCode,
            pengkurbanName: sohibul,
          });
        }
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
```

Note: `event.e_event_date` access depends on `Event` entity schema. Verify with `cat src/events/event.entity.ts` — if date column is `event_date` or `hijri_year`, adjust. If no event date, default to today (works for testing).

- [ ] **Step 2: Build**

Run: `npm run build`

Fix any type errors (e.g., enum casts, schema mismatch).

- [ ] **Step 3: Commit**

```bash
git add src/scheduling/scheduling.service.ts
git commit -m "feat(scheduling): generateSchedule wires algorithm to DB"
```

### Task 10: Service tests for generateSchedule (key paths)

**Files:**
- Create: `src/scheduling/scheduling.service.spec.ts`

- [ ] **Step 1: Write integration-style test with mocked repos**

`src/scheduling/scheduling.service.spec.ts`:
```typescript
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { SchedulingService } from './scheduling.service';
import { Animal } from '../animals/animal.entity';
import { Pengkurban } from '../pengkurban/pengkurban.entity';
import { FormResponse } from '../form-responses/form-response.entity';

describe('SchedulingService.generateSchedule', () => {
  let service: SchedulingService;
  let animalRepo: any;
  let pengkurbanRepo: any;
  let formRepo: any;

  beforeEach(async () => {
    animalRepo = {
      find: jest.fn(),
      findOne: jest.fn(),
      update: jest.fn().mockResolvedValue({ affected: 1 }),
      manager: {
        createQueryBuilder: () => ({
          select: () => ({
            from: () => ({
              where: () => ({
                getRawOne: () => ({ e_event_date: new Date('2026-06-06T00:00:00+07:00') }),
              }),
            }),
          }),
        }),
      },
    };
    pengkurbanRepo = { findOne: jest.fn(), find: jest.fn().mockResolvedValue([]) };
    formRepo = { findOne: jest.fn().mockResolvedValue(null) };

    const moduleRef = await Test.createTestingModule({
      providers: [
        SchedulingService,
        { provide: getRepositoryToken(Animal), useValue: animalRepo },
        { provide: getRepositoryToken(Pengkurban), useValue: pengkurbanRepo },
        { provide: getRepositoryToken(FormResponse), useValue: formRepo },
      ],
    }).compile();
    service = moduleRef.get(SchedulingService);
  });

  it('returns zero counts when no animals', async () => {
    animalRepo.find.mockResolvedValue([]);
    const result = await service.generateSchedule('event-1');
    expect(result.teams.SAPI.total).toBe(0);
    expect(result.teams.KAMBING_DOMBA.total).toBe(0);
  });

  it('separates animals into SAPI vs KAMBING_DOMBA teams', async () => {
    const animals = [
      { id: 'a1', animalCode: 'ANM-1', animalType: 'SAPI_PERORANGAN', eventId: 'event-1', pengkurbanId: 'pk1', isVendorAnimal: false },
      { id: 'a2', animalCode: 'ANM-2', animalType: 'KAMBING', eventId: 'event-1', pengkurbanId: 'pk2', isVendorAnimal: false },
    ];
    animalRepo.find.mockResolvedValue(animals);
    pengkurbanRepo.findOne.mockImplementation((opts: any) =>
      Promise.resolve({ id: opts.where.id, name: `pk-${opts.where.id}`, status: 'CONFIRMED', deletedAt: null }),
    );
    const result = await service.generateSchedule('event-1');
    expect(result.teams.SAPI.total).toBe(1);
    expect(result.teams.KAMBING_DOMBA.total).toBe(1);
    expect(animalRepo.update).toHaveBeenCalled();
  });

  it('clears existing schedules before regenerating', async () => {
    animalRepo.find.mockResolvedValue([]);
    await service.generateSchedule('event-1');
    expect(animalRepo.update).toHaveBeenCalledWith({ eventId: 'event-1' }, { scheduledAt: null, scheduledTeam: null });
  });
});
```

- [ ] **Step 2: Run tests**

Run: `npx jest src/scheduling/scheduling.service.spec.ts`

Expected: all pass. Iterate on test setup (mock chain depth) until green.

- [ ] **Step 3: Commit**

```bash
git add src/scheduling/scheduling.service.spec.ts
git commit -m "feat(scheduling): generateSchedule service tests"
```

### Task 11: Service — updateSlot + clearSchedule

**Files:**
- Modify: `src/scheduling/scheduling.service.ts`

- [ ] **Step 1: Add methods**

```typescript
  async updateSlot(
    animalId: string,
    patch: { scheduledAt?: Date | null; scheduledTeam?: Team | null; scheduledNote?: string | null },
  ): Promise<Animal> {
    await this.animalRepo.update(animalId, patch);
    const updated = await this.animalRepo.findOne({ where: { id: animalId } });
    if (!updated) throw new Error(`Animal ${animalId} not found after update`);
    return updated;
  }

  async clearSchedule(eventId: string): Promise<{ cleared: number }> {
    const r = await this.animalRepo.update(
      { eventId },
      { scheduledAt: null, scheduledTeam: null, scheduledNote: null },
    );
    return { cleared: r.affected ?? 0 };
  }
```

- [ ] **Step 2: Build**

Run: `npm run build`

Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add src/scheduling/scheduling.service.ts
git commit -m "feat(scheduling): updateSlot + clearSchedule"
```

---

## Backend: Controllers

### Task 12: Admin controller (CRUD endpoints)

**Files:**
- Create: `src/scheduling/scheduling.controller.ts`

- [ ] **Step 1: Implement controller**

```typescript
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
  BadRequestException,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { Response } from 'express';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { Role } from '../common/enums/role.enum';
import { SchedulingService, Team } from './scheduling.service';

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
      scheduledAt: body.scheduledAt === undefined ? undefined : body.scheduledAt ? new Date(body.scheduledAt) : null,
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
```

- [ ] **Step 2: Register controller in module**

Modify `src/scheduling/scheduling.module.ts`:
```typescript
import { SchedulingController } from './scheduling.controller';
// ...
controllers: [SchedulingController],
```

- [ ] **Step 3: Build**

Run: `npm run build`

Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add src/scheduling/scheduling.controller.ts src/scheduling/scheduling.module.ts
git commit -m "feat(scheduling): admin REST controller"
```

### Task 13: Public controller (sohibul portal endpoint)

**Files:**
- Create: `src/scheduling/scheduling.public.controller.ts`

- [ ] **Step 1: Inspect sohibul portal auth pattern**

Read `src/sohibul-portal/*.ts` (or whatever module handles `/api/public/portal/*`). Identify the guard / token decorator used (e.g., `@UseGuards(SohibulTokenGuard)` or session-based). Mirror that pattern.

Run: `find /Users/fajarfirdaus/Development/panitia-kurban/src -type d -name "*portal*" -o -name "*sohibul*"`

- [ ] **Step 2: Implement public controller**

`src/scheduling/scheduling.public.controller.ts`:
```typescript
import { Controller, Get, Req, UseGuards } from '@nestjs/common';
// import the same guard the existing sohibul portal uses, e.g.:
// import { SohibulPortalGuard } from '../sohibul-portal/guards/sohibul-portal.guard';
import { SchedulingService } from './scheduling.service';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, In } from 'typeorm';
import { Animal } from '../animals/animal.entity';

@Controller('api/public/scheduling')
// @UseGuards(SohibulPortalGuard) — uncomment after confirming guard class name
export class SchedulingPublicController {
  constructor(
    private readonly service: SchedulingService,
    @InjectRepository(Animal)
    private readonly animalRepo: Repository<Animal>,
  ) {}

  @Get('me')
  async myJadwal(@Req() req: any) {
    // req.sohibul.pengkurbanIds populated by SohibulPortalGuard (verify field name)
    const pengkurbanIds: string[] = req.sohibul?.pengkurbanIds ?? [];
    if (pengkurbanIds.length === 0) return [];

    // Find animals belonging to this sohibul:
    // - direct: animal.pengkurbanId in pengkurbanIds
    // - kolektif: animal.animalType = pengkurban.animalType where pengkurban.id in ids
    // Simpler: 2-step query.
    const directAnimals = await this.animalRepo.find({
      where: { pengkurbanId: In(pengkurbanIds), scheduledAt: null as any },
    });
    // Hack: use find without raw NotNull — adjust to TypeORM Not(IsNull()) for scheduledAt
    // Quick correct version:
    return this.animalRepo.find({
      where: pengkurbanIds.map((pid) => ({ pengkurbanId: pid })),
      order: { scheduledAt: 'ASC' },
    });
  }
}
```

Note: this is rough. Refine after Step 1 confirms the actual sohibul auth pattern. Key question: does sohibul auth expose `pengkurbanIds` or `phone`?

If `phone`: query `pengkurban WHERE phone = X` then traverse to animals.

- [ ] **Step 3: Register in module**

```typescript
controllers: [SchedulingController, SchedulingPublicController],
```

- [ ] **Step 4: Build**

Run: `npm run build`

Fix imports + guard reference.

- [ ] **Step 5: Commit**

```bash
git add src/scheduling/scheduling.public.controller.ts src/scheduling/scheduling.module.ts
git commit -m "feat(scheduling): public controller for sohibul portal"
```

---

## Backend: WA Broadcast

### Task 14: Broadcast service — buildSohibulMessage + buildPanitiaMessage

**Files:**
- Create: `src/scheduling/scheduling-broadcast.service.ts`
- Create: `src/scheduling/scheduling-broadcast.service.spec.ts`

- [ ] **Step 1: Write failing tests for templates**

`src/scheduling/scheduling-broadcast.service.spec.ts`:
```typescript
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { SchedulingBroadcastService } from './scheduling-broadcast.service';
import { SchedulingService } from './scheduling.service';
import { Animal } from '../animals/animal.entity';
import { Pengkurban } from '../pengkurban/pengkurban.entity';

describe('SchedulingBroadcastService', () => {
  let service: SchedulingBroadcastService;
  let schedulingService: any;

  beforeEach(async () => {
    schedulingService = {
      getSchedule: jest.fn(),
    };
    const m = await Test.createTestingModule({
      providers: [
        SchedulingBroadcastService,
        { provide: SchedulingService, useValue: schedulingService },
      ],
    }).compile();
    service = m.get(SchedulingBroadcastService);
  });

  it('builds sohibul message with team sections', async () => {
    schedulingService.getSchedule.mockImplementation((eventId: string, team?: string) =>
      Promise.resolve(
        team === 'SAPI'
          ? [{ animal: { animalCode: 'ANM-1', animalType: 'SAPI_PERORANGAN', scheduledAt: new Date('2026-06-06T07:30:00+07:00') }, pengkurban: [{ name: 'Asep' }] }]
          : [{ animal: { animalCode: 'ANM-2', animalType: 'KAMBING', scheduledAt: new Date('2026-06-06T07:30:00+07:00') }, pengkurban: [{ name: 'Haris' }] }],
      ),
    );
    const msg = await service.buildSohibulMessage('event-1');
    expect(msg).toContain('JADWAL PENYEMBELIHAN');
    expect(msg).toContain('Tim SAPI');
    expect(msg).toContain('07:30 — Asep');
    expect(msg).toContain('Tim KAMBING/DOMBA');
    expect(msg).toContain('07:30 — Haris');
    expect(msg).toContain('portal.html');
  });

  it('panitia message includes generated by + warning footer when overflow > 0', async () => {
    schedulingService.getSchedule.mockResolvedValue([]);
    const msg = await service.buildPanitiaMessage('event-1', { overflow: 4, mismatches: 3, generatedBy: 'Fajar' });
    expect(msg).toContain('Generated');
    expect(msg).toContain('Fajar');
    expect(msg).toContain('4 hewan overflow');
    expect(msg).toContain('3 preferensi');
  });
});
```

- [ ] **Step 2: Run test, expect fail**

Run: `npx jest src/scheduling/scheduling-broadcast.service.spec.ts`

Expected: FAIL.

- [ ] **Step 3: Implement service**

`src/scheduling/scheduling-broadcast.service.ts`:
```typescript
import { Injectable, Logger } from '@nestjs/common';
import { SchedulingService, Team } from './scheduling.service';

function fmtTime(d: Date): string {
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function animalTypeLabel(t: string): string {
  if (t.startsWith('SAPI_KOLEKTIF')) return 'kolektif';
  if (t === 'SAPI_PERORANGAN') return 'perorangan';
  if (t === 'KAMBING') return 'kambing';
  if (t === 'DOMBA') return 'domba';
  return t;
}

@Injectable()
export class SchedulingBroadcastService {
  private readonly logger = new Logger(SchedulingBroadcastService.name);

  constructor(private readonly schedulingService: SchedulingService) {}

  async buildSohibulMessage(eventId: string): Promise<string> {
    const lines: string[] = [];
    lines.push('📋 *JADWAL PENYEMBELIHAN — 1447H*\n');
    lines.push('Assalamualaikum bapak/ibu sohibul qurban,');
    lines.push('Berikut jadwal penyembelihan Idul Adha:\n');

    for (const team of ['SAPI', 'KAMBING_DOMBA'] as Team[]) {
      const items = await this.schedulingService.getSchedule(eventId, team);
      const teamLabel = team === 'SAPI' ? 'SAPI' : 'KAMBING/DOMBA';
      lines.push(`*Tim ${teamLabel}* (${items.length} hewan)`);
      for (const it of items) {
        if (!it.animal.scheduledAt) continue;
        const time = fmtTime(new Date(it.animal.scheduledAt));
        const names = it.pengkurban.map((pk) => pk.name).filter(Boolean);
        let line = `${time} — ${names[0] ?? '(tanpa sohibul)'}`;
        if (names.length > 1) {
          line += ` (kolektif: ${names.join(', ')})`;
        }
        lines.push(line);
      }
      lines.push('');
    }

    lines.push('📍 Halaman Masjid Al Hijrah CGE');
    lines.push('⏰ Mohon hadir min. 15 menit sebelum slot Anda');
    lines.push('🔗 Detail di portal: https://kurban.masjidalhijrahcge.id/portal.html');
    lines.push('');
    lines.push('Jazakumullahu khairan,');
    lines.push('Panitia Kurban');
    return lines.join('\n');
  }

  async buildPanitiaMessage(
    eventId: string,
    summary: { overflow?: number; mismatches?: number; generatedBy?: string },
  ): Promise<string> {
    let base = await this.buildSohibulMessage(eventId);
    const now = new Date();
    const stamp = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')} ${fmtTime(now)} WIB`;
    base += `\n\n_Generated ${stamp} by ${summary.generatedBy ?? 'admin'}_`;
    if (summary.overflow && summary.overflow > 0) {
      base += `\n⚠️ ${summary.overflow} hewan overflow di luar target 12:00`;
    }
    if (summary.mismatches && summary.mismatches > 0) {
      base += `\n⚠️ ${summary.mismatches} preferensi waktu tidak ter-honor (lihat dashboard)`;
    }
    return base;
  }
}
```

- [ ] **Step 4: Run tests, expect pass**

Run: `npx jest src/scheduling/scheduling-broadcast.service.spec.ts`

Iterate if needed.

- [ ] **Step 5: Register in module**

Modify `src/scheduling/scheduling.module.ts`:
```typescript
import { SchedulingBroadcastService } from './scheduling-broadcast.service';
// ...
providers: [SchedulingService, SchedulingBroadcastService],
```

- [ ] **Step 6: Commit**

```bash
git add src/scheduling/scheduling-broadcast.service.ts src/scheduling/scheduling-broadcast.service.spec.ts src/scheduling/scheduling.module.ts
git commit -m "feat(scheduling): WA broadcast message builders + tests"
```

### Task 15: Broadcast service — sendToGroup + endpoint

**Files:**
- Modify: `src/scheduling/scheduling-broadcast.service.ts`
- Modify: `src/scheduling/scheduling.controller.ts`

- [ ] **Step 1: Add sendToGroup method**

Append in `SchedulingBroadcastService`:

```typescript
  async sendToGroup(groupJid: string, message: string): Promise<void> {
    const url = process.env.WA_BOT_URL;
    const key = process.env.WA_BOT_API_KEY;
    if (!url || !key) {
      this.logger.warn('WA_BOT_URL or WA_BOT_API_KEY not set — skipping send');
      return;
    }
    try {
      const res = await fetch(`${url}/send`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-api-key': key,
        },
        body: JSON.stringify({ jid: groupJid, message }),
      });
      if (!res.ok) {
        throw new Error(`wa-bot returned ${res.status}: ${await res.text()}`);
      }
    } catch (e) {
      const err = e as Error;
      console.error('[scheduling-broadcast sendToGroup]', err.stack || err.message);
      throw err;
    }
  }

  resolveGroupJid(target: 'sohibul_group' | 'panitia_group'): string | null {
    if (target === 'sohibul_group') return process.env.WA_SOHIBUL_GROUP_JID || null;
    if (target === 'panitia_group') {
      return process.env.WA_PANITIA_GROUP_JID || process.env.WA_NOTIFY_PHONE || null;
    }
    return null;
  }
```

- [ ] **Step 2: Add broadcast endpoint to controller**

Modify `src/scheduling/scheduling.controller.ts`:
```typescript
import { SchedulingBroadcastService } from './scheduling-broadcast.service';
import { ServiceUnavailableException } from '@nestjs/common';

// constructor:
constructor(
  private readonly service: SchedulingService,
  private readonly broadcast: SchedulingBroadcastService,
) {}

// add endpoint:
@Post('broadcast')
@Roles(Role.SUPER_ADMIN, Role.KETUA_PANITIA)
async sendBroadcast(
  @Body() body: { eventId: string; target: 'sohibul_group' | 'panitia_group'; dryRun?: boolean },
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
```

- [ ] **Step 3: Build**

Run: `npm run build`

Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add src/scheduling/scheduling-broadcast.service.ts src/scheduling/scheduling.controller.ts
git commit -m "feat(scheduling): broadcast endpoint + sendToGroup"
```

---

## Backend: PDF Export

### Task 16: PDF service

**Files:**
- Create: `src/scheduling/scheduling-pdf.service.ts`
- Create: `src/scheduling/scheduling-pdf.service.spec.ts`

- [ ] **Step 1: Inspect existing pdfkit pattern**

Run: `sed -n '360,440p' /Users/fajarfirdaus/Development/panitia-kurban/src/vouchers/vouchers.service.ts`

Observe: `const PDFDocument = require('pdfkit'); const doc = new PDFDocument({...}); doc.pipe(stream); doc.text(...); doc.end();`

- [ ] **Step 2: Implement PDF service**

`src/scheduling/scheduling-pdf.service.ts`:
```typescript
import { Injectable } from '@nestjs/common';
import { Writable } from 'stream';
import { SchedulingService, Team } from './scheduling.service';

const PDFDocument = require('pdfkit');

function fmtTime(d: Date): string {
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

@Injectable()
export class SchedulingPdfService {
  constructor(private readonly schedulingService: SchedulingService) {}

  async generate(eventId: string): Promise<Buffer> {
    const sapi = await this.schedulingService.getSchedule(eventId, 'SAPI');
    const kambing = await this.schedulingService.getSchedule(eventId, 'KAMBING_DOMBA');

    return new Promise((resolve, reject) => {
      const doc = new PDFDocument({ size: 'A4', layout: 'landscape', margin: 40 });
      const buffers: Buffer[] = [];
      doc.on('data', (b: Buffer) => buffers.push(b));
      doc.on('end', () => resolve(Buffer.concat(buffers)));
      doc.on('error', reject);

      // Header
      doc.fontSize(18).text('Jadwal Penyembelihan Idul Adha 1447H', { align: 'center' });
      doc.fontSize(10).text('Masjid Al Hijrah CGE', { align: 'center' });
      doc.moveDown();

      // 2-column table layout
      const startY = doc.y;
      const colWidth = (doc.page.width - 80) / 2;

      doc.fontSize(13).text('Tim SAPI', 40, startY, { width: colWidth, underline: true });
      doc.text('Tim KAMBING/DOMBA', 40 + colWidth, startY, { width: colWidth, underline: true });

      doc.moveDown();
      const tableY = doc.y;
      doc.fontSize(10);

      sapi.forEach((it, i) => {
        if (!it.animal.scheduledAt) return;
        const time = fmtTime(new Date(it.animal.scheduledAt));
        const name = it.pengkurban[0]?.name ?? '(vendor)';
        doc.text(`${time}  ${name}`, 40, tableY + i * 16, { width: colWidth });
      });

      kambing.forEach((it, i) => {
        if (!it.animal.scheduledAt) return;
        const time = fmtTime(new Date(it.animal.scheduledAt));
        const name = it.pengkurban[0]?.name ?? '(vendor)';
        doc.text(`${time}  ${name}`, 40 + colWidth, tableY + i * 16, { width: colWidth });
      });

      // Footer
      const now = new Date();
      doc
        .fontSize(8)
        .text(
          `Generated ${now.toISOString()} — page 1`,
          40,
          doc.page.height - 40,
          { align: 'center', width: doc.page.width - 80 },
        );

      doc.end();
    });
  }
}
```

- [ ] **Step 3: Write smoke test**

`src/scheduling/scheduling-pdf.service.spec.ts`:
```typescript
import { Test } from '@nestjs/testing';
import { SchedulingPdfService } from './scheduling-pdf.service';
import { SchedulingService } from './scheduling.service';

describe('SchedulingPdfService', () => {
  it('produces non-empty PDF buffer', async () => {
    const schedulingService = {
      getSchedule: jest.fn().mockResolvedValue([
        { animal: { animalCode: 'ANM-1', animalType: 'SAPI_PERORANGAN', scheduledAt: new Date('2026-06-06T07:30:00+07:00') }, pengkurban: [{ name: 'Asep' }] },
      ]),
    };
    const m = await Test.createTestingModule({
      providers: [SchedulingPdfService, { provide: SchedulingService, useValue: schedulingService }],
    }).compile();
    const svc = m.get(SchedulingPdfService);
    const buf = await svc.generate('event-1');
    expect(buf.length).toBeGreaterThan(500);
    expect(buf.subarray(0, 4).toString()).toBe('%PDF');
  });
});
```

- [ ] **Step 4: Run test**

Run: `npx jest src/scheduling/scheduling-pdf.service.spec.ts`

Expected: pass.

- [ ] **Step 5: Wire PDF endpoint in controller**

Modify `src/scheduling/scheduling.controller.ts`:
```typescript
import { SchedulingPdfService } from './scheduling-pdf.service';

// constructor:
constructor(
  private readonly service: SchedulingService,
  private readonly broadcast: SchedulingBroadcastService,
  private readonly pdf: SchedulingPdfService,
) {}

// endpoint:
@Get('pdf')
@Roles(Role.SUPER_ADMIN, Role.KETUA_PANITIA, Role.PANITIA_VOUCHER)
async exportPdf(@Query('eventId') eventId: string, @Res() res: Response) {
  if (!eventId) throw new BadRequestException('eventId required');
  const buf = await this.pdf.generate(eventId);
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="jadwal-${eventId.slice(0,8)}.pdf"`);
  res.end(buf);
}
```

- [ ] **Step 6: Register in module**

```typescript
import { SchedulingPdfService } from './scheduling-pdf.service';
providers: [SchedulingService, SchedulingBroadcastService, SchedulingPdfService],
```

- [ ] **Step 7: Build + commit**

```bash
npm run build
git add src/scheduling/scheduling-pdf.service.ts src/scheduling/scheduling-pdf.service.spec.ts src/scheduling/scheduling.controller.ts src/scheduling/scheduling.module.ts
git commit -m "feat(scheduling): PDF export"
```

---

## Backend: Permintaan Daging (cheat sheet seset)

### Task 16a: extractPermintaan mapper (TDD)

**Files:**
- Modify: `src/scheduling/scheduling-mappers.ts`
- Modify: `src/scheduling/scheduling-mappers.spec.ts`

- [ ] **Step 1: Write failing tests**

Append to `scheduling-mappers.spec.ts`:

```typescript
import { extractPermintaan, summarizePermintaan } from './scheduling-mappers';

describe('extractPermintaan', () => {
  it('extracts all 4 fields from full form data', () => {
    const data = {
      'Hak daging qurban untuk Sohibul Qurban': 'Ambil Hak Paha Kanan untuk hewan qurban perorangan',
      'Permintaan khusus untuk bagian tertentu untuk Sohibul Qurban': 'Kaki, Ekor',
      'Catatan pengambilan hak sebagian': 'Paha kanan 4kg',
      'Catatan Khusus untuk Panitia': 'Tolong bagian has dalam',
    };
    expect(extractPermintaan(data)).toEqual({
      hak: 'Ambil Hak Paha Kanan untuk hewan qurban perorangan',
      permintaanKhusus: 'Kaki, Ekor',
      catatanSebagian: 'Paha kanan 4kg',
      catatanPanitia: 'Tolong bagian has dalam',
    });
  });

  it('returns empty strings for missing fields', () => {
    expect(extractPermintaan({})).toEqual({
      hak: '',
      permintaanKhusus: '',
      catatanSebagian: '',
      catatanPanitia: '',
    });
  });

  it('handles null/undefined data', () => {
    expect(extractPermintaan(null as any)).toEqual({
      hak: '', permintaanKhusus: '', catatanSebagian: '', catatanPanitia: '',
    });
  });
});

describe('summarizePermintaan (1-liner)', () => {
  it('returns dash for all-empty', () => {
    expect(summarizePermintaan([{ hak: '', permintaanKhusus: '', catatanSebagian: '', catatanPanitia: '' }])).toBe('—');
  });

  it('joins permintaan khusus for single sohibul', () => {
    expect(summarizePermintaan([{ hak: 'Paha kanan', permintaanKhusus: 'Kaki', catatanSebagian: '', catatanPanitia: '' }])).toContain('Kaki');
  });

  it('truncates long output to ~40 char', () => {
    const long = summarizePermintaan([
      { hak: '', permintaanKhusus: 'Kaki, ekor, lidah, has dalam, paha, iga, sandung lamur', catatanSebagian: '', catatanPanitia: '' },
    ]);
    expect(long.length).toBeLessThanOrEqual(43); // 40 + ellipsis "..."
  });

  it('prefixes nama for kolektif (multiple sohibul)', () => {
    const out = summarizePermintaan([
      { name: 'Asep', hak: '', permintaanKhusus: 'Kaki', catatanSebagian: '', catatanPanitia: '' },
      { name: 'Margono', hak: '', permintaanKhusus: 'Has dalam', catatanSebagian: '', catatanPanitia: '' },
    ]);
    expect(out).toMatch(/Asep/);
    expect(out).toMatch(/Margono/);
  });
});
```

- [ ] **Step 2: Run test, expect fail**

Run: `npx jest src/scheduling/scheduling-mappers.spec.ts`

Expected: FAIL "extractPermintaan is not exported".

- [ ] **Step 3: Implement mappers**

Append to `src/scheduling/scheduling-mappers.ts`:

```typescript
export interface Permintaan {
  hak: string;
  permintaanKhusus: string;
  catatanSebagian: string;
  catatanPanitia: string;
  name?: string;
}

export function extractPermintaan(data: Record<string, string> | null | undefined): Permintaan {
  const d = data ?? {};
  return {
    hak: (d['Hak daging qurban untuk Sohibul Qurban'] ?? '').trim(),
    permintaanKhusus: (d['Permintaan khusus untuk bagian tertentu untuk Sohibul Qurban'] ?? '').trim(),
    catatanSebagian: (d['Catatan pengambilan hak sebagian'] ?? '').trim(),
    catatanPanitia: (d['Catatan Khusus untuk Panitia'] ?? '').trim(),
  };
}

export function summarizePermintaan(items: Permintaan[]): string {
  const MAX_LEN = 40;
  const parts: string[] = [];
  for (const p of items) {
    const interesting = [p.permintaanKhusus, p.catatanSebagian].filter(Boolean).join(' / ');
    if (!interesting) continue;
    parts.push(p.name ? `${p.name}:${interesting}` : interesting);
  }
  if (parts.length === 0) return '—';
  const joined = parts.join(' • ');
  if (joined.length <= MAX_LEN) return joined;
  return joined.slice(0, MAX_LEN) + '...';
}
```

- [ ] **Step 4: Run test, expect pass**

Run: `npx jest src/scheduling/scheduling-mappers.spec.ts`

Expected: pass.

- [ ] **Step 5: Commit**

```bash
git add src/scheduling/scheduling-mappers.ts src/scheduling/scheduling-mappers.spec.ts
git commit -m "feat(scheduling): extractPermintaan + summarizePermintaan mappers"
```

### Task 16b: Service — getSesetData (cheat sheet payload)

**Files:**
- Modify: `src/scheduling/scheduling.service.ts`

- [ ] **Step 1: Add method**

Append in `SchedulingService` class:

```typescript
  /**
   * Cheat sheet untuk tim jagal/seset: list animal yang udah dijadwalkan, dengan
   * permintaan tiap sohibul. Individual = 1 sohibul; kolektif = many.
   */
  async getSesetData(
    eventId: string,
    team?: Team,
  ): Promise<Array<{
    animal: Animal;
    sohibulRequests: Array<{ name: string; phone: string | null } & import('./scheduling-mappers').Permintaan>;
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
            const { extractPermintaan } = await import('./scheduling-mappers');
            const perm = extractPermintaan(fr?.data ?? null);
            return { name: pk.name, phone: pk.phone ?? null, ...perm };
          }),
        );
        return { animal, sohibulRequests };
      }),
    );
  }
```

- [ ] **Step 2: Build**

Run: `npm run build`

Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add src/scheduling/scheduling.service.ts
git commit -m "feat(scheduling): getSesetData service method"
```

### Task 16c: Controller endpoint — GET /seset (JSON)

**Files:**
- Modify: `src/scheduling/scheduling.controller.ts`

- [ ] **Step 1: Add endpoint**

```typescript
@Get('seset')
@Roles(Role.SUPER_ADMIN, Role.KETUA_PANITIA, Role.PANITIA_VOUCHER, Role.PANITIA_SCANNER)
async sesetData(@Query('eventId') eventId: string, @Query('team') team?: Team) {
  if (!eventId) throw new BadRequestException('eventId required');
  return this.service.getSesetData(eventId, team);
}
```

- [ ] **Step 2: Build**

Run: `npm run build`

- [ ] **Step 3: Commit**

```bash
git add src/scheduling/scheduling.controller.ts
git commit -m "feat(scheduling): GET /seset endpoint (cheat sheet JSON)"
```

### Task 16d: PDF jadwal — tambah kolom Permintaan

**Files:**
- Modify: `src/scheduling/scheduling-pdf.service.ts`

- [ ] **Step 1: Modify generate() to include permintaan column**

Update `SchedulingPdfService.generate` to call `getSesetData` instead of `getSchedule` (gives access to per-sohibul permintaan), then render 1-line summary per row:

```typescript
import { summarizePermintaan } from './scheduling-mappers';

// in generate():
const sapi = await this.schedulingService.getSesetData(eventId, 'SAPI');
const kambing = await this.schedulingService.getSesetData(eventId, 'KAMBING_DOMBA');

// in render loop, modify each row to include permintaan summary:
function renderRow(it: any, x: number, y: number, w: number) {
  if (!it.animal.scheduledAt) return;
  const time = fmtTime(new Date(it.animal.scheduledAt));
  const name = it.sohibulRequests[0]?.name ?? '(vendor)';
  const permintaan = summarizePermintaan(
    it.sohibulRequests.map((s: any) => ({ ...s, name: it.sohibulRequests.length > 1 ? s.name : undefined })),
  );
  doc.fontSize(10).text(`${time}  ${name}`, x, y, { width: w });
  doc.fontSize(8).fillColor('#666').text(`Permintaan: ${permintaan}`, x, y + 12, { width: w });
  doc.fillColor('#000');
}
```

Adjust row height (now ~24px instead of 16px) and tableY iteration accordingly.

- [ ] **Step 2: Update test**

Modify `scheduling-pdf.service.spec.ts` to mock `getSesetData` instead of `getSchedule`. Add assertion that "Permintaan" string appears in buffer (via simple substring search of PDF text — pdfkit embeds text in stream).

- [ ] **Step 3: Run tests**

```bash
npx jest src/scheduling/scheduling-pdf.service.spec.ts
```

- [ ] **Step 4: Commit**

```bash
git add src/scheduling/scheduling-pdf.service.ts src/scheduling/scheduling-pdf.service.spec.ts
git commit -m "feat(scheduling): tambah kolom Permintaan di PDF jadwal"
```

### Task 16e: PDF cheat sheet seset (long-form per hewan)

**Files:**
- Create: `src/scheduling/scheduling-seset-pdf.service.ts`
- Create: `src/scheduling/scheduling-seset-pdf.service.spec.ts`

- [ ] **Step 1: Implement service**

`src/scheduling/scheduling-seset-pdf.service.ts`:
```typescript
import { Injectable } from '@nestjs/common';
import { SchedulingService } from './scheduling.service';

const PDFDocument = require('pdfkit');

function fmtTime(d: Date): string {
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

@Injectable()
export class SchedulingSesetPdfService {
  constructor(private readonly schedulingService: SchedulingService) {}

  async generate(eventId: string): Promise<Buffer> {
    const items = await this.schedulingService.getSesetData(eventId);

    return new Promise((resolve, reject) => {
      const doc = new PDFDocument({ size: 'A4', layout: 'portrait', margin: 40 });
      const buffers: Buffer[] = [];
      doc.on('data', (b: Buffer) => buffers.push(b));
      doc.on('end', () => resolve(Buffer.concat(buffers)));
      doc.on('error', reject);

      doc.fontSize(16).text('Cheat Sheet Tim Seset — 1447H', { align: 'center' });
      doc.fontSize(9).text('Masjid Al Hijrah CGE', { align: 'center' });
      doc.moveDown();

      let isFirst = true;
      for (const it of items) {
        if (!it.animal.scheduledAt) continue;
        if (!isFirst && doc.y > doc.page.height - 200) {
          doc.addPage();
        }
        isFirst = false;

        const time = fmtTime(new Date(it.animal.scheduledAt));
        const team = it.animal.scheduledTeam === 'SAPI' ? 'SAPI' : 'KAMBING/DOMBA';

        // Animal card header
        doc.fontSize(12).fillColor('#000').text(
          `${time} • Tim ${team} • ${it.animal.animalCode} (${it.animal.animalType})`,
          { underline: true },
        );
        doc.moveDown(0.3);

        if (it.sohibulRequests.length === 0) {
          doc.fontSize(10).fillColor('#888').text('(vendor — tidak ada permintaan)');
          doc.moveDown();
          continue;
        }

        for (const s of it.sohibulRequests) {
          doc.fontSize(11).fillColor('#000').text(`Sohibul: ${s.name}`);
          doc.fontSize(9).fillColor('#444');
          doc.text(`  Hak: ${s.hak || '—'}`);
          doc.text(`  Permintaan khusus: ${s.permintaanKhusus || '—'}`);
          doc.text(`  Catatan pengambilan: ${s.catatanSebagian || '—'}`);
          doc.text(`  Catatan untuk panitia: ${s.catatanPanitia || '—'}`);
          doc.moveDown(0.2);
        }

        doc.moveDown(0.5);
        doc.strokeColor('#ccc').moveTo(40, doc.y).lineTo(doc.page.width - 40, doc.y).stroke();
        doc.moveDown(0.5);
      }

      const now = new Date();
      doc.fontSize(7).fillColor('#888').text(
        `Generated ${now.toISOString()}`,
        40,
        doc.page.height - 30,
        { align: 'center', width: doc.page.width - 80 },
      );

      doc.end();
    });
  }
}
```

- [ ] **Step 2: Smoke test**

`src/scheduling/scheduling-seset-pdf.service.spec.ts`:
```typescript
import { Test } from '@nestjs/testing';
import { SchedulingSesetPdfService } from './scheduling-seset-pdf.service';
import { SchedulingService } from './scheduling.service';

describe('SchedulingSesetPdfService', () => {
  it('produces non-empty PDF', async () => {
    const svc = {
      getSesetData: jest.fn().mockResolvedValue([
        {
          animal: { animalCode: 'ANM-1', animalType: 'SAPI_PERORANGAN', scheduledAt: new Date('2026-06-06T07:30:00+07:00'), scheduledTeam: 'SAPI' },
          sohibulRequests: [{
            name: 'Asep', phone: '0812', hak: 'Paha kanan', permintaanKhusus: 'Kaki', catatanSebagian: '', catatanPanitia: '',
          }],
        },
      ]),
    };
    const m = await Test.createTestingModule({
      providers: [SchedulingSesetPdfService, { provide: SchedulingService, useValue: svc }],
    }).compile();
    const buf = await m.get(SchedulingSesetPdfService).generate('event-1');
    expect(buf.length).toBeGreaterThan(500);
    expect(buf.subarray(0, 4).toString()).toBe('%PDF');
  });
});
```

- [ ] **Step 3: Wire endpoint + module**

Modify `src/scheduling/scheduling.controller.ts`:
```typescript
import { SchedulingSesetPdfService } from './scheduling-seset-pdf.service';

// constructor add: private readonly sesetPdf: SchedulingSesetPdfService

@Get('seset/pdf')
@Roles(Role.SUPER_ADMIN, Role.KETUA_PANITIA, Role.PANITIA_VOUCHER, Role.PANITIA_SCANNER)
async sesetPdfExport(@Query('eventId') eventId: string, @Res() res: Response) {
  if (!eventId) throw new BadRequestException('eventId required');
  const buf = await this.sesetPdf.generate(eventId);
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="seset-${eventId.slice(0,8)}.pdf"`);
  res.end(buf);
}
```

Modify `src/scheduling/scheduling.module.ts`:
```typescript
import { SchedulingSesetPdfService } from './scheduling-seset-pdf.service';
providers: [..., SchedulingSesetPdfService],
```

- [ ] **Step 4: Build + test + commit**

```bash
npm run build
npx jest src/scheduling/scheduling-seset-pdf.service.spec.ts
git add src/scheduling/scheduling-seset-pdf.service.ts src/scheduling/scheduling-seset-pdf.service.spec.ts src/scheduling/scheduling.controller.ts src/scheduling/scheduling.module.ts
git commit -m "feat(scheduling): cheat sheet PDF tim seset"
```

### Task 16f: Frontend — seset.html cheat sheet page

**Files:**
- Create: `client/seset.html`
- Create: `client/js/seset.js`
- Modify: `client/js/app.js` (sidebar)

- [ ] **Step 1: Create page**

`client/seset.html`:
```html
<!doctype html>
<html lang="id">
<head>
  <meta charset="utf-8">
  <title>Cheat Sheet Seset — Panitia Kurban</title>
  <script src="https://cdn.tailwindcss.com"></script>
  <script src="/js/app.js" defer></script>
</head>
<body class="bg-gray-50">
  <div id="layout"></div>
  <main class="max-w-4xl mx-auto p-4">
    <div class="flex items-center justify-between mb-4">
      <h1 class="text-xl font-bold">Cheat Sheet Tim Seset</h1>
      <select id="eventSelect" class="border rounded p-2"></select>
    </div>
    <div class="flex gap-2 mb-4">
      <select id="teamFilter" class="border rounded p-2">
        <option value="">Semua tim</option>
        <option value="SAPI">Tim SAPI</option>
        <option value="KAMBING_DOMBA">Tim KAMBING/DOMBA</option>
      </select>
      <button id="btnPdf" class="bg-gray-200 px-4 py-2 rounded">Download PDF</button>
    </div>
    <div id="content"></div>
  </main>
  <script src="/js/seset.js" defer></script>
</body>
</html>
```

- [ ] **Step 2: Create JS**

`client/js/seset.js`:
```javascript
(async () => {
  const $ = (s) => document.querySelector(s);
  let currentEventId = null;

  async function loadEvents() {
    const events = await api('/events');
    const sel = $('#eventSelect');
    sel.innerHTML = events.map((e) => `<option value="${e.id}">${e.hijriYear ?? e.name ?? e.id}</option>`).join('');
    currentEventId = events[0]?.id;
    sel.onchange = () => { currentEventId = sel.value; refresh(); };
  }

  function fmtTime(iso) {
    const d = new Date(iso);
    return `${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
  }

  function teamLabel(t) {
    return t === 'SAPI' ? 'SAPI' : 'KAMBING/DOMBA';
  }

  function renderCard(it) {
    if (!it.animal.scheduledAt) return '';
    const sohibulHtml = it.sohibulRequests.length === 0
      ? '<p class="text-gray-500 italic">(vendor — tidak ada permintaan)</p>'
      : it.sohibulRequests.map((s) => `
        <div class="ml-4 mb-3">
          <div class="font-semibold">Sohibul: ${s.name}</div>
          <div class="text-sm text-gray-700">Hak: ${s.hak || '—'}</div>
          <div class="text-sm text-gray-700">Permintaan khusus: ${s.permintaanKhusus || '—'}</div>
          <div class="text-sm text-gray-700">Catatan pengambilan: ${s.catatanSebagian || '—'}</div>
          <div class="text-sm text-gray-700">Catatan untuk panitia: ${s.catatanPanitia || '—'}</div>
        </div>
      `).join('');

    return `
      <div class="bg-white p-4 mb-3 rounded shadow-sm border">
        <div class="font-mono text-blue-900 font-bold mb-2">
          ${fmtTime(it.animal.scheduledAt)} • Tim ${teamLabel(it.animal.scheduledTeam)} • ${it.animal.animalCode} (${it.animal.animalType})
        </div>
        ${sohibulHtml}
      </div>
    `;
  }

  async function refresh() {
    if (!currentEventId) return;
    const team = $('#teamFilter').value;
    const url = team ? `/scheduling/seset?eventId=${currentEventId}&team=${team}` : `/scheduling/seset?eventId=${currentEventId}`;
    const items = await api(url);
    $('#content').innerHTML = items.map(renderCard).join('') || '<p class="text-gray-500">Belum ada jadwal. Generate dulu di halaman Jadwal.</p>';
  }

  $('#teamFilter').onchange = refresh;
  $('#btnPdf').onclick = () => window.open(`/api/scheduling/seset/pdf?eventId=${currentEventId}`, '_blank');

  await loadEvents();
  await refresh();
})();
```

- [ ] **Step 3: Add sidebar nav (deferred — combined with Task 17)**

Note for Task 17: tambah 2 nav item sekaligus — "Jadwal Penyembelihan" + "Cheat Sheet Seset" (📋, href `/seset.html`, roles SUPER_ADMIN/KETUA/VOUCHER/SCANNER).

- [ ] **Step 4: Smoke**

Visit `http://localhost:3000/seset.html` after generate jadwal di Task 19. Verify cards render dengan permintaan per sohibul. Filter tim → list ke-filter. Klik Download PDF → file download.

- [ ] **Step 5: Commit**

```bash
git add client/seset.html client/js/seset.js
git commit -m "feat(scheduling): seset.html cheat sheet UI"
```

---

## Frontend: Admin UI

### Task 17: Sidebar nav item "Jadwal"

**Files:**
- Modify: `client/js/app.js`

- [ ] **Step 1: Find nav array**

Run: `grep -n "Hewan\|navItems\|getRoleNav" /Users/fajarfirdaus/Development/panitia-kurban/client/js/app.js | head -10`

- [ ] **Step 2: Add nav items between "Hewan" and "Scan Kartu Hewan"**

Find the entry for `{ label: 'Hewan', ... }` and insert after:

```javascript
{
  label: 'Jadwal Penyembelihan',
  icon: '📅',
  href: '/jadwal.html',
  roles: ['SUPER_ADMIN', 'KETUA_PANITIA', 'PANITIA_VOUCHER'],
},
{
  label: 'Cheat Sheet Seset',
  icon: '📋',
  href: '/seset.html',
  roles: ['SUPER_ADMIN', 'KETUA_PANITIA', 'PANITIA_VOUCHER', 'PANITIA_SCANNER'],
},
```

- [ ] **Step 3: Smoke (open admin page locally)**

Run dev: `npm run start:dev` (in background), open `http://localhost:3000/dashboard.html` after logging in, verify sidebar shows new item.

- [ ] **Step 4: Commit**

```bash
git add client/js/app.js
git commit -m "feat(scheduling): sidebar nav item Jadwal"
```

### Task 18: jadwal.html scaffold (table + summary)

**Files:**
- Create: `client/jadwal.html`

- [ ] **Step 1: Create page**

Copy structure from `client/animals.html` (similar admin list page) as starting template. Modify body to:

```html
<!doctype html>
<html lang="id">
<head>
  <meta charset="utf-8">
  <title>Jadwal Penyembelihan — Panitia Kurban</title>
  <script src="https://cdn.tailwindcss.com"></script>
  <script src="/js/app.js" defer></script>
</head>
<body class="bg-gray-50">
  <div id="layout"></div>

  <main class="max-w-6xl mx-auto p-4">
    <div class="flex items-center justify-between mb-4">
      <h1 class="text-xl font-bold">Jadwal Penyembelihan</h1>
      <select id="eventSelect" class="border rounded p-2"></select>
    </div>

    <div class="flex gap-2 mb-4">
      <button id="btnGenerate" class="bg-blue-600 text-white px-4 py-2 rounded">Generate Ulang</button>
      <button id="btnPdf" class="bg-gray-200 px-4 py-2 rounded">Export PDF</button>
      <div class="relative inline-block">
        <button id="btnBroadcast" class="bg-green-600 text-white px-4 py-2 rounded">Broadcast WA ▾</button>
        <div id="broadcastMenu" class="hidden absolute bg-white shadow border rounded mt-1 right-0 z-10">
          <button data-target="sohibul_group" class="block px-4 py-2 hover:bg-gray-100 w-full text-left">Post ke grup sohibul</button>
          <button data-target="panitia_group" class="block px-4 py-2 hover:bg-gray-100 w-full text-left">Post ke grup panitia</button>
        </div>
      </div>
    </div>

    <div id="summary" class="mb-4 text-sm text-gray-600"></div>

    <div class="grid grid-cols-2 gap-4">
      <section>
        <h2 class="font-semibold mb-2">Tim SAPI</h2>
        <table class="w-full border-collapse" id="tableSapi">
          <thead><tr class="bg-gray-100"><th class="text-left p-2">Jam</th><th class="text-left p-2">Sohibul / Hewan</th></tr></thead>
          <tbody></tbody>
        </table>
      </section>
      <section>
        <h2 class="font-semibold mb-2">Tim KAMBING/DOMBA</h2>
        <table class="w-full border-collapse" id="tableKambing">
          <thead><tr class="bg-gray-100"><th class="text-left p-2">Jam</th><th class="text-left p-2">Sohibul / Hewan</th></tr></thead>
          <tbody></tbody>
        </table>
      </section>
    </div>

    <section id="mismatchSection" class="mt-6 hidden">
      <h2 class="font-semibold mb-2">⚠ Mismatches</h2>
      <ul id="mismatchList" class="list-disc pl-5 text-sm"></ul>
    </section>
  </main>

  <script src="/js/jadwal.js" defer></script>
</body>
</html>
```

- [ ] **Step 2: Verify static load**

Visit `http://localhost:3000/jadwal.html` (after `npm run start:dev`). Page renders shell, sidebar shows item.

- [ ] **Step 3: Commit**

```bash
git add client/jadwal.html
git commit -m "feat(scheduling): jadwal.html shell"
```

### Task 19: jadwal.js — render list + generate + edit interactions

**Files:**
- Create: `client/js/jadwal.js`

- [ ] **Step 1: Implement page logic**

`client/js/jadwal.js`:
```javascript
(async () => {
  const $ = (s) => document.querySelector(s);

  let currentEventId = null;
  let lastSummary = null;

  async function loadEvents() {
    const events = await api('/events');
    const sel = $('#eventSelect');
    sel.innerHTML = events.map((e) => `<option value="${e.id}">${e.hijriYear ?? e.name ?? e.id}</option>`).join('');
    currentEventId = events[0]?.id;
    sel.onchange = () => { currentEventId = sel.value; refresh(); };
  }

  async function refresh() {
    if (!currentEventId) return;
    const items = await api(`/scheduling?eventId=${currentEventId}`);
    renderTables(items);
  }

  function fmtTime(iso) {
    const d = new Date(iso);
    return `${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
  }

  function renderTables(items) {
    const sapi = items.filter((i) => i.animal.scheduledTeam === 'SAPI');
    const kambing = items.filter((i) => i.animal.scheduledTeam === 'KAMBING_DOMBA');

    function row(it) {
      const names = it.pengkurban.map((p) => p.name).filter(Boolean);
      const label = names.length > 1 ? `${names[0]} (+${names.length - 1})` : (names[0] ?? '(vendor)');
      return `<tr class="border-b"><td class="p-2 font-mono">${fmtTime(it.animal.scheduledAt)}</td><td class="p-2"><button class="text-blue-700 hover:underline" data-animal-id="${it.animal.id}">${label}</button><br><span class="text-xs text-gray-500">${it.animal.animalCode}</span></td></tr>`;
    }
    $('#tableSapi tbody').innerHTML = sapi.map(row).join('') || '<tr><td colspan="2" class="p-2 text-gray-400">Belum ada jadwal</td></tr>';
    $('#tableKambing tbody').innerHTML = kambing.map(row).join('') || '<tr><td colspan="2" class="p-2 text-gray-400">Belum ada jadwal</td></tr>';

    // Wire edit clicks
    document.querySelectorAll('[data-animal-id]').forEach((btn) => {
      btn.onclick = () => openEditModal(btn.dataset.animalId, items.find((i) => i.animal.id === btn.dataset.animalId));
    });
  }

  function openEditModal(animalId, item) {
    const newTime = prompt(`Jam baru untuk ${item.animal.animalCode} (format HH:MM, kosong = clear):`, fmtTime(item.animal.scheduledAt));
    if (newTime === null) return;
    const newTeam = prompt('Tim (SAPI / KAMBING_DOMBA):', item.animal.scheduledTeam);
    const eventDate = new Date(item.animal.scheduledAt);
    let scheduledAt = null;
    if (newTime) {
      const [h, m] = newTime.split(':').map(Number);
      eventDate.setHours(h, m, 0, 0);
      scheduledAt = eventDate.toISOString();
    }
    api(`/scheduling/${animalId}`, { method: 'PATCH', body: JSON.stringify({ scheduledAt, scheduledTeam: newTeam }) })
      .then(refresh);
  }

  $('#btnGenerate').onclick = async () => {
    if (!confirm('Generate ulang akan overwrite jadwal existing. Lanjut?')) return;
    const summary = await api('/scheduling/generate', { method: 'POST', body: JSON.stringify({ eventId: currentEventId }) });
    lastSummary = summary;
    $('#summary').textContent = `SAPI ${summary.teams.SAPI.total} (${summary.teams.SAPI.firstSlot ?? '-'}–${summary.teams.SAPI.lastSlot ?? '-'}, overflow ${summary.teams.SAPI.overflow}) • KAMBING/DOMBA ${summary.teams.KAMBING_DOMBA.total} (overflow ${summary.teams.KAMBING_DOMBA.overflow})`;
    if (summary.mismatches.length > 0) {
      $('#mismatchSection').classList.remove('hidden');
      $('#mismatchList').innerHTML = summary.mismatches.map((m) => `<li>${m.pengkurbanName} (${m.animalCode}) — preferensi ${m.preferred}, dijadwalkan ${m.scheduled}: ${m.reason}</li>`).join('');
    }
    refresh();
  };

  $('#btnPdf').onclick = () => {
    window.open(`/api/scheduling/pdf?eventId=${currentEventId}`, '_blank');
  };

  $('#btnBroadcast').onclick = () => $('#broadcastMenu').classList.toggle('hidden');
  $('#broadcastMenu').querySelectorAll('[data-target]').forEach((btn) => {
    btn.onclick = async () => {
      $('#broadcastMenu').classList.add('hidden');
      const preview = await api('/scheduling/broadcast', { method: 'POST', body: JSON.stringify({ eventId: currentEventId, target: btn.dataset.target, dryRun: true }) });
      if (confirm(`Preview:\n\n${preview.preview}\n\nKirim ke ${preview.group_jid}?`)) {
        await api('/scheduling/broadcast', { method: 'POST', body: JSON.stringify({ eventId: currentEventId, target: btn.dataset.target }) });
        alert('Sent!');
      }
    };
  });

  await loadEvents();
  await refresh();
})();
```

Note: `api()` helper assumed already loaded from `app.js` (per CLAUDE.md convention — `api()` prepends `/api/` automatically; don't write `/api/scheduling`, write `/scheduling`).

- [ ] **Step 2: Smoke**

Open browser → `/jadwal.html`. Click Generate Ulang → table populates. Click row → prompt for new time → updates.

- [ ] **Step 3: Commit**

```bash
git add client/js/jadwal.js
git commit -m "feat(scheduling): jadwal.js — list/generate/edit/broadcast interactions"
```

---

## Frontend: Sohibul Portal

### Task 20: "Jadwal Anda" section in portal

**Files:**
- Modify: `client/portal-dashboard.html`

- [ ] **Step 1: Inspect existing portal structure**

Read first 100 lines of `client/portal-dashboard.html` to find where to insert. Look for section that displays the sohibul's animals/pengkurban.

- [ ] **Step 2: Add jadwal section**

Add above the existing animals list:

```html
<section id="jadwalSection" class="mb-4 p-4 bg-blue-50 border border-blue-200 rounded">
  <h2 class="font-semibold text-blue-900 mb-2">📅 Jadwal Penyembelihan Anda</h2>
  <div id="jadwalContent" class="text-sm">Memuat…</div>
</section>

<script>
(async () => {
  try {
    const items = await fetch('/api/public/scheduling/me', {
      headers: { /* sohibul token header — copy from existing portal-dashboard fetch pattern */ }
    }).then(r => r.json());
    const el = document.getElementById('jadwalContent');
    if (!Array.isArray(items) || items.length === 0) {
      el.innerHTML = '<p class="text-gray-600">Jadwal belum di-generate panitia, mohon ditunggu.</p>';
      return;
    }
    el.innerHTML = items.map(a => {
      if (!a.scheduledAt) {
        return `<div class="mb-2">Hewan ${a.animalCode}: jadwal belum tersedia</div>`;
      }
      const d = new Date(a.scheduledAt);
      const time = `${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
      const teamLabel = a.scheduledTeam === 'SAPI' ? 'Sapi' : 'Kambing/Domba';
      return `<div class="mb-2">
        <div><strong>Hewan:</strong> ${a.animalCode} (${a.animalType})</div>
        <div><strong>Jam:</strong> ${time} WIB</div>
        <div><strong>Tim:</strong> ${teamLabel}</div>
      </div>`;
    }).join('<hr class="my-2">') + `
      <p class="mt-3 text-blue-800">⏰ Mohon hadir minimal 15 menit sebelum slot Anda.</p>
      <p class="text-blue-800">📞 Update via grup sohibul + portal ini.</p>`;
  } catch (e) {
    console.error('[portal jadwal]', e);
    document.getElementById('jadwalContent').textContent = 'Gagal memuat jadwal.';
  }
})();
</script>
```

Important: copy the EXACT fetch header pattern that other portal-dashboard.html sections use to call `/api/public/portal/*` — likely a Bearer token from `sessionStorage` or similar. Mirror that.

- [ ] **Step 3: Smoke**

Login portal as sohibul test → dashboard shows section. Initially "Jadwal belum di-generate" → setelah generate di admin → reload portal → tampil jam + tim.

- [ ] **Step 4: Commit**

```bash
git add client/portal-dashboard.html
git commit -m "feat(scheduling): Jadwal Anda section in portal-dashboard"
```

---

## Wrap-up

### Task 21: Document env vars + manual smoke checklist

**Files:**
- Modify: `.env.example` (if exists)
- Reference: spec §10, §11

- [ ] **Step 1: Add env vars to .env.example**

```env
# Scheduling broadcast
WA_SOHIBUL_GROUP_JID=<grup-id>@g.us
WA_PANITIA_GROUP_JID=<grup-id>@g.us
```

- [ ] **Step 2: Run manual smoke checklist (per spec §10)**

Walk through all 8 smoke steps on local dev. Tick each.

- [ ] **Step 3: Run full test suite**

```bash
npm run test
npm run build
```

Expected: all green.

- [ ] **Step 4: Commit + open PR**

```bash
git add .env.example
git commit -m "docs(scheduling): document env vars for WA broadcast"
git push origin feat/scheduling
gh pr create --title "feat(scheduling): jadwal penyembelihan Phase 1" --body "$(cat <<'EOF'
## Summary
- Backend: scheduling module (entity migration, service, controllers, broadcast, PDF)
- Frontend: jadwal.html admin + Jadwal Anda section di portal sohibul
- WA broadcast ke grup (bukan loop per-nomor — hindari ban risk)

See spec: docs/superpowers/specs/2026-05-26-jadwal-penyembelihan-design.md

## Test plan
- [ ] Migration SQL applied di Neon
- [ ] Generate jadwal di /jadwal.html — summary match expected animal count
- [ ] Edit slot via tabel
- [ ] Export PDF — file download, isi sesuai
- [ ] Broadcast dry-run — preview muncul
- [ ] Broadcast real ke grup test
- [ ] Portal sohibul login — section Jadwal Anda render
EOF
)"
```

---

## Pre-flight findings (fill during Task 1)

_To be filled in during Task 1 execution._

- wa-bot supports group JID via /send: TBD
- WA_SOHIBUL_GROUP_JID: TBD
- WA_PANITIA_GROUP_JID: TBD
