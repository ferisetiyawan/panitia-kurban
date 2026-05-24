# Voucher Pickup Feature Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `DISTRIBUTED` pickup stage between `ACTIVE` and `CLAIMED` so panitia can scan and record which warga took which vouchers before hari H.

**Architecture:** Extend the existing vouchers module — add 5 nullable columns to the `vouchers` table, a new `scanPickup` service method, a new `POST /api/vouchers/scan-pickup` endpoint, and a new `scanner-pickup.html` frontend page with session-based multi-scan. TypeORM `synchronize: true` auto-applies schema changes; no manual migration needed.

**Tech Stack:** NestJS 10 (TypeScript), TypeORM, PostgreSQL (Neon), Vanilla HTML + Tailwind CDN, html5-qrcode

---

## File Map

| Action | File | What changes |
|---|---|---|
| Modify | `src/common/enums/voucher-status.enum.ts` | Add `DISTRIBUTED` |
| Modify | `src/vouchers/voucher.entity.ts` | Add 5 pickup columns |
| Modify | `src/vouchers/vouchers.service.spec.ts` | Separate mocks, add tests for `scanPickup`, `scan` with DISTRIBUTED, `stats` with distributed count |
| Modify | `src/vouchers/vouchers.service.ts` | Add `scanPickup`, update `scan` response, update `stats` + `exportCsv` |
| Modify | `src/vouchers/vouchers.controller.ts` | Add `POST scan-pickup` endpoint |
| Modify | `src/dashboard/dashboard.service.ts` | Add `distributedVouchers` count |
| Create | `client/scanner-pickup.html` | New pickup scanner page with session UX |
| Modify | `client/scanner.html` | Add link to pickup scanner |
| Modify | `client/vouchers.html` | Add DISTRIBUTED filter option + badge label |
| Modify | `client/dashboard.html` | Add "Sudah Diambil" stat tile |

---

## Task 1: Add DISTRIBUTED to enum and entity

**Files:**
- Modify: `src/common/enums/voucher-status.enum.ts`
- Modify: `src/vouchers/voucher.entity.ts`

- [ ] **Step 1: Update VoucherStatus enum**

Replace the entire content of `src/common/enums/voucher-status.enum.ts`:

```typescript
export enum VoucherStatus {
  ACTIVE = 'ACTIVE',
  DISTRIBUTED = 'DISTRIBUTED',
  CLAIMED = 'CLAIMED',
  CANCELLED = 'CANCELLED',
}
```

- [ ] **Step 2: Add pickup columns to Voucher entity**

Add the following imports and columns to `src/vouchers/voucher.entity.ts`. Add after the existing `claimedAt` column:

```typescript
// Add UpdateDateColumn to imports if not present
import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
  OneToMany,
} from 'typeorm';
```

Add these 5 columns after the `claimedAt` field:

```typescript
  @Column({ name: 'pickup_cluster', nullable: true })
  pickupCluster: string;

  @Column({ name: 'pickup_unit', nullable: true })
  pickupUnit: string;

  @Column({ name: 'pickup_phone', nullable: true })
  pickupPhone: string;

  @Column({ name: 'picked_up_at', type: 'timestamp', nullable: true })
  pickedUpAt: Date;

  @Column({ name: 'picked_up_by', nullable: true })
  pickedUpById: string;

  @ManyToOne(() => User, { nullable: true })
  @JoinColumn({ name: 'picked_up_by' })
  pickedUpBy: User;
```

- [ ] **Step 3: Start the app to verify TypeORM syncs the new columns**

```bash
cd /Users/fajar.firdaus/Development/panitia-kurban
npm run start:dev
```

Expected: app starts without error, columns auto-created. Stop with Ctrl+C after confirming.

- [ ] **Step 4: Commit**

```bash
git add src/common/enums/voucher-status.enum.ts src/vouchers/voucher.entity.ts
git commit -m "feat: add DISTRIBUTED status and pickup columns to voucher entity"
```

---

## Task 2: TDD — scanPickup service method

**Files:**
- Modify: `src/vouchers/vouchers.service.spec.ts`
- Modify: `src/vouchers/vouchers.service.ts`

- [ ] **Step 1: Update the spec file with separate repository mocks and new tests**

Replace the entire content of `src/vouchers/vouchers.service.spec.ts`:

```typescript
import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { VouchersService } from './vouchers.service';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Voucher } from './voucher.entity';
import { ScanLog } from './scan-log.entity';
import { Event } from '../events/event.entity';
import { VouchersGateway } from './vouchers.gateway';
import { VoucherStatus } from '../common/enums/voucher-status.enum';

describe('VouchersService', () => {
  let service: VouchersService;

  const mockVouchersRepository = {
    find: jest.fn(),
    findOne: jest.fn(),
    create: jest.fn(),
    save: jest.fn(),
    createQueryBuilder: jest.fn(),
    remove: jest.fn(),
  };

  const mockScanLogsRepository = {
    save: jest.fn(),
    createQueryBuilder: jest.fn(),
    delete: jest.fn(),
  };

  const mockEventsRepository = {
    findOne: jest.fn(),
  };

  const mockGateway = {
    notifyVoucherClaimed: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        VouchersService,
        { provide: getRepositoryToken(Voucher), useValue: mockVouchersRepository },
        { provide: getRepositoryToken(ScanLog), useValue: mockScanLogsRepository },
        { provide: getRepositoryToken(Event), useValue: mockEventsRepository },
        { provide: VouchersGateway, useValue: mockGateway },
      ],
    }).compile();

    service = module.get<VouchersService>(VouchersService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  // ─── scanPickup ───────────────────────────────────────────────

  describe('scanPickup', () => {
    it('should set voucher to DISTRIBUTED and write PICKUP log', async () => {
      const mockVoucher = {
        id: 'voucher-uuid',
        voucherCode: 'QRB-1447H-TESTAAAA',
        status: VoucherStatus.ACTIVE,
      };
      mockVouchersRepository.findOne.mockResolvedValue(mockVoucher);
      mockVouchersRepository.save.mockImplementation((v: any) => Promise.resolve(v));
      mockScanLogsRepository.save.mockResolvedValue({});

      const result = await service.scanPickup(
        'QRB-1447H-TESTAAAA',
        'user-id',
        'MARGATA',
        '1/5',
        '08123456789',
      );

      expect(result.voucher.status).toBe(VoucherStatus.DISTRIBUTED);
      expect(result.voucher.pickupCluster).toBe('MARGATA');
      expect(result.voucher.pickupUnit).toBe('1/5');
      expect(result.voucher.pickupPhone).toBe('08123456789');
      expect(result.voucher.pickedUpById).toBe('user-id');
      expect(result.message).toContain('diambil');
      expect(mockScanLogsRepository.save).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'PICKUP' }),
      );
    });

    it('should throw NotFoundException if voucher not found', async () => {
      mockVouchersRepository.findOne.mockResolvedValue(null);

      await expect(
        service.scanPickup('INVALID', 'user-id', 'MARGATA', '1/5', undefined),
      ).rejects.toThrow(NotFoundException);
    });

    it('should throw BadRequestException if voucher is already DISTRIBUTED', async () => {
      mockVouchersRepository.findOne.mockResolvedValue({
        id: 'uuid',
        voucherCode: 'QRB-1447H-TEST',
        status: VoucherStatus.DISTRIBUTED,
      });

      await expect(
        service.scanPickup('QRB-1447H-TEST', 'user-id', 'MARGATA', '1/5', undefined),
      ).rejects.toThrow('Voucher sudah diambil sebelumnya');
    });

    it('should throw BadRequestException if voucher is CLAIMED', async () => {
      mockVouchersRepository.findOne.mockResolvedValue({
        id: 'uuid',
        voucherCode: 'QRB-1447H-TEST',
        status: VoucherStatus.CLAIMED,
      });

      await expect(
        service.scanPickup('QRB-1447H-TEST', 'user-id', 'MARGATA', '1/5', undefined),
      ).rejects.toThrow('Voucher sudah diklaim di hari H');
    });

    it('should throw BadRequestException if voucher is CANCELLED', async () => {
      mockVouchersRepository.findOne.mockResolvedValue({
        id: 'uuid',
        voucherCode: 'QRB-1447H-TEST',
        status: VoucherStatus.CANCELLED,
      });

      await expect(
        service.scanPickup('QRB-1447H-TEST', 'user-id', 'MARGATA', '1/5', undefined),
      ).rejects.toThrow('Voucher sudah dibatalkan');
    });
  });

  // ─── scan (update: accept DISTRIBUTED) ───────────────────────

  describe('scan', () => {
    it('should claim an ACTIVE voucher', async () => {
      const mockVoucher = {
        id: 'uuid',
        voucherCode: 'QRB-1447H-TEST',
        status: VoucherStatus.ACTIVE,
      };
      mockVouchersRepository.findOne.mockResolvedValue(mockVoucher);
      mockVouchersRepository.save.mockImplementation((v: any) => Promise.resolve(v));
      mockScanLogsRepository.save.mockResolvedValue({});

      const result = await service.scan('QRB-1447H-TEST', 'user-id');

      expect(result.voucher.status).toBe(VoucherStatus.CLAIMED);
      expect(result.pickupInfo).toBeUndefined();
    });

    it('should claim a DISTRIBUTED voucher and return pickupInfo', async () => {
      const pickedUpAt = new Date('2026-05-24T13:34:00Z');
      const mockVoucher = {
        id: 'uuid',
        voucherCode: 'QRB-1447H-TEST',
        status: VoucherStatus.DISTRIBUTED,
        pickupCluster: 'MARGATA',
        pickupUnit: '1/5',
        pickedUpAt,
      };
      mockVouchersRepository.findOne.mockResolvedValue(mockVoucher);
      mockVouchersRepository.save.mockImplementation((v: any) => Promise.resolve(v));
      mockScanLogsRepository.save.mockResolvedValue({});

      const result = await service.scan('QRB-1447H-TEST', 'user-id');

      expect(result.voucher.status).toBe(VoucherStatus.CLAIMED);
      expect(result.pickupInfo).toContain('MARGATA');
      expect(result.pickupInfo).toContain('1/5');
    });
  });

  // ─── stats (update: include distributed) ─────────────────────

  describe('stats', () => {
    it('should include distributed count', async () => {
      const clonedQb = {
        andWhere: jest.fn().mockReturnThis(),
        getCount: jest.fn()
          .mockResolvedValueOnce(20)   // claimed
          .mockResolvedValueOnce(40)   // active
          .mockResolvedValueOnce(5)    // cancelled
          .mockResolvedValueOnce(35),  // distributed
      };
      const mainQb = {
        where: jest.fn().mockReturnThis(),
        clone: jest.fn().mockReturnValue(clonedQb),
        getCount: jest.fn().mockResolvedValue(100),
      };
      mockVouchersRepository.createQueryBuilder.mockReturnValue(mainQb);

      const result = await service.stats();

      expect(result.total).toBe(100);
      expect(result.claimed).toBe(20);
      expect(result.active).toBe(40);
      expect(result.cancelled).toBe(5);
      expect(result.distributed).toBe(35);
    });
  });
});
```

- [ ] **Step 2: Run tests — expect failures for scanPickup and updated scan/stats**

```bash
cd /Users/fajar.firdaus/Development/panitia-kurban
npm test -- --testPathPattern=vouchers.service.spec --no-coverage
```

Expected: most `scanPickup` tests FAIL with "service.scanPickup is not a function", `stats` FAIL with "expected undefined to be 35".

- [ ] **Step 3: Add `scanPickup` method to `vouchers.service.ts`**

Add this method after the `scan` method (around line 240 in service):

```typescript
  async scanPickup(
    voucherCode: string,
    userId: string,
    pickupCluster: string,
    pickupUnit: string,
    pickupPhone: string | undefined,
  ): Promise<{ voucher: Voucher; message: string }> {
    const voucher = await this.findByCode(voucherCode);

    if (voucher.status === VoucherStatus.DISTRIBUTED) {
      await this.scanLogsRepository.save({
        voucherId: voucher.id,
        scannedById: userId,
        action: 'REJECTED',
        notes: 'Voucher sudah diambil sebelumnya',
      });
      throw new BadRequestException('Voucher sudah diambil sebelumnya');
    }

    if (voucher.status === VoucherStatus.CLAIMED) {
      await this.scanLogsRepository.save({
        voucherId: voucher.id,
        scannedById: userId,
        action: 'REJECTED',
        notes: 'Voucher sudah diklaim di hari H',
      });
      throw new BadRequestException('Voucher sudah diklaim di hari H');
    }

    if (voucher.status === VoucherStatus.CANCELLED) {
      await this.scanLogsRepository.save({
        voucherId: voucher.id,
        scannedById: userId,
        action: 'REJECTED',
        notes: 'Voucher sudah dibatalkan',
      });
      throw new BadRequestException('Voucher sudah dibatalkan');
    }

    voucher.status = VoucherStatus.DISTRIBUTED;
    voucher.pickupCluster = pickupCluster;
    voucher.pickupUnit = pickupUnit;
    voucher.pickupPhone = pickupPhone ?? null;
    voucher.pickedUpAt = new Date();
    voucher.pickedUpById = userId;
    const saved = await this.vouchersRepository.save(voucher);

    await this.scanLogsRepository.save({
      voucherId: voucher.id,
      scannedById: userId,
      action: 'PICKUP',
      notes: `Voucher diambil oleh ${pickupCluster} ${pickupUnit}`,
    });

    return { voucher: saved, message: 'Voucher berhasil dicatat sebagai sudah diambil' };
  }
```

- [ ] **Step 4: Update the `scan` method response to include `pickupInfo`**

Find the `scan` method's return statement:
```typescript
    return { voucher: saved, message: 'Voucher berhasil diklaim!' };
```

Replace it with:
```typescript
    let pickupInfo: string | undefined;
    if (voucher.pickupCluster) {
      const dateStr = voucher.pickedUpAt
        ? new Date(voucher.pickedUpAt).toLocaleDateString('id-ID', {
            day: 'numeric', month: 'long', year: 'numeric',
          })
        : '-';
      pickupInfo = `Diambil oleh ${voucher.pickupCluster} ${voucher.pickupUnit || ''} pada ${dateStr}`.trim();
    }

    return { voucher: saved, message: 'Voucher berhasil diklaim!', pickupInfo };
```

Note: The `scan` method needs access to `voucher.pickupCluster` before saving. Move the `pickupInfo` construction BEFORE `voucher.status = VoucherStatus.CLAIMED` (so you read the pickup fields before they might be cleared). Place it right before the claim block:

```typescript
    // Build pickup info before claiming
    let pickupInfo: string | undefined;
    if (voucher.pickupCluster) {
      const dateStr = voucher.pickedUpAt
        ? new Date(voucher.pickedUpAt).toLocaleDateString('id-ID', {
            day: 'numeric', month: 'long', year: 'numeric',
          })
        : '-';
      pickupInfo = `Diambil oleh ${voucher.pickupCluster} ${voucher.pickupUnit || ''} pada ${dateStr}`.trim();
    }

    // Claim the voucher
    voucher.status = VoucherStatus.CLAIMED;
    voucher.claimedById = userId;
    voucher.claimedAt = new Date();
    const saved = await this.vouchersRepository.save(voucher);

    await this.scanLogsRepository.save({
      voucherId: voucher.id,
      scannedById: userId,
      action: 'CLAIMED',
      notes: 'Voucher berhasil diklaim',
    });

    this.vouchersGateway.notifyVoucherClaimed({ voucherCode });

    return { voucher: saved, message: 'Voucher berhasil diklaim!', pickupInfo };
```

- [ ] **Step 5: Update `stats` method to include `distributed` count**

Find the `stats` method. After the `cancelled` count query, add:

```typescript
    const distributed = await qb
      .clone()
      .andWhere('v.status = :status', { status: VoucherStatus.DISTRIBUTED })
      .getCount();
```

Update the return object:
```typescript
    return { total, claimed, active, cancelled, distributed };
```

- [ ] **Step 6: Run tests — expect all to pass**

```bash
npm test -- --testPathPattern=vouchers.service.spec --no-coverage
```

Expected: All tests PASS.

- [ ] **Step 7: Commit**

```bash
git add src/vouchers/vouchers.service.spec.ts src/vouchers/vouchers.service.ts
git commit -m "feat: add scanPickup method, update scan + stats for DISTRIBUTED status"
```

---

## Task 3: Update exportCsv to include pickup columns

**Files:**
- Modify: `src/vouchers/vouchers.service.ts`

- [ ] **Step 1: Update the CSV header in `exportCsv`**

Find the `exportCsv` method. Update the header array:

```typescript
    const header = [
      'Kode Voucher',
      'Event',
      'Tahun',
      'Status',
      'Tgl Distribusi',
      'Dibuat Oleh',
      'Cluster Pickup',
      'Unit Pickup',
      'No HP Pickup',
      'Tgl Pickup',
      'Diklaim Oleh',
      'Tgl Klaim',
    ].join(',');
```

Update the row mapping to include pickup fields between `createdBy` and `claimedBy`:

```typescript
    const rows = vouchers.map((v: Voucher) => {
      return [
        v.voucherCode,
        v.event?.name || '',
        v.event?.year || '',
        v.status,
        v.distributionDate
          ? new Date(v.distributionDate).toISOString().split('T')[0]
          : '',
        v.createdBy?.fullName || '',
        v.pickupCluster || '',
        v.pickupUnit || '',
        v.pickupPhone || '',
        v.pickedUpAt ? new Date(v.pickedUpAt).toISOString() : '',
        v.claimedBy?.fullName || '',
        v.claimedAt ? new Date(v.claimedAt).toISOString() : '',
      ]
        .map((field) => `"${String(field).replace(/"/g, '""')}"`)
        .join(',');
    });
```

- [ ] **Step 2: Commit**

```bash
git add src/vouchers/vouchers.service.ts
git commit -m "feat: add pickup columns to voucher CSV export"
```

---

## Task 4: Add scan-pickup controller endpoint

**Files:**
- Modify: `src/vouchers/vouchers.controller.ts`

- [ ] **Step 1: Add `scan-pickup` endpoint**

Add the following method after the existing `scan` method (around line 183):

```typescript
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
```

- [ ] **Step 2: Verify the endpoint is accessible (quick smoke test)**

Start the app and test with curl:

```bash
npm run start:dev &
sleep 5

# Login first to get a token
TOKEN=$(curl -s -X POST http://localhost:3000/api/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"username":"admin","password":"admin123"}' | jq -r '.access_token')

# Test scan-pickup with a real ACTIVE voucher code from DB
curl -s -X POST http://localhost:3000/api/vouchers/scan-pickup \
  -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"voucherCode":"REPLACE_WITH_REAL_CODE","pickupCluster":"MARGATA","pickupUnit":"1/5"}' | jq .

kill %1
```

Expected: `{"voucher": {..., "status": "DISTRIBUTED"}, "message": "Voucher berhasil dicatat sebagai sudah diambil"}`

- [ ] **Step 3: Commit**

```bash
git add src/vouchers/vouchers.controller.ts
git commit -m "feat: add POST /api/vouchers/scan-pickup endpoint"
```

---

## Task 5: Update dashboard service to include distributedVouchers

**Files:**
- Modify: `src/dashboard/dashboard.service.ts`

- [ ] **Step 1: Add distributedVouchers count**

In `src/dashboard/dashboard.service.ts`, after the `cancelledVouchers` query, add:

```typescript
    const distributedVouchers = await voucherQb
      .clone()
      .andWhere('v.status = :status', { status: VoucherStatus.DISTRIBUTED })
      .getCount();
```

Update the return object to include it (around line 86):

```typescript
    return {
      event: activeEvent,
      totalVouchers,
      claimedVouchers,
      activeVouchers,
      cancelledVouchers,
      distributedVouchers,
      // ... rest of fields unchanged
    };
```

- [ ] **Step 2: Commit**

```bash
git add src/dashboard/dashboard.service.ts
git commit -m "feat: add distributedVouchers count to dashboard stats"
```

---

## Task 6: Create scanner-pickup.html frontend

**Files:**
- Create: `client/scanner-pickup.html`

- [ ] **Step 1: Create the file**

Create `client/scanner-pickup.html` with the following content:

```html
<!DOCTYPE html>
<html lang="id">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Scanner Pickup Kupon - Panitia Kurban</title>
  <script src="https://cdn.tailwindcss.com"></script>
  <link rel="stylesheet" href="/css/style.css">
  <script src="https://unpkg.com/html5-qrcode@2.3.8/html5-qrcode.min.js"></script>
  <link rel="manifest" href="/manifest.json">
  <script>
    if ('serviceWorker' in navigator) {
      window.addEventListener('load', () => {
        navigator.serviceWorker.register('/sw.js');
      });
    }
  </script>
</head>
<body>
  <div class="bg-orb bg-orb-1"></div>
  <div class="bg-orb bg-orb-2"></div>
  <aside class="sidebar" id="sidebar">
    <div class="sidebar-logo"><h1>🕌 Al Hijrah CGE</h1><p>Sistem Panitia Kurban</p></div>
    <nav class="sidebar-nav"></nav>
  </aside>
  <nav class="bottom-nav" id="bottom-nav"><div class="bottom-nav-items"></div></nav>

  <main class="main-content">
    <div class="top-bar">
      <div class="flex items-center gap-3">
        <button class="hamburger" onclick="toggleSidebar()">
          <svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 6h16M4 12h16M4 18h16"/>
          </svg>
        </button>
        <h2>Scanner Pickup Kupon</h2>
      </div>
      <div class="user-info" id="user-info"></div>
    </div>

    <div class="max-w-lg mx-auto">

      <!-- State 1: Form penerima -->
      <div id="form-section">
        <div class="glass-card p-6 mb-4">
          <div class="text-center mb-5">
            <div class="text-4xl mb-2">📦</div>
            <h3 class="font-bold text-emerald-200 text-lg">Pickup Kupon</h3>
            <p class="text-sm text-emerald-300/60 mt-1">Catat siapa yang mengambil kupon</p>
          </div>

          <div class="space-y-4">
            <div>
              <label class="text-xs text-emerald-300/60 uppercase tracking-wider mb-1 block">Cluster *</label>
              <select id="pickup-cluster" class="input-field w-full">
                <option value="">— Pilih Cluster —</option>
                <option value="MARGATA">Margata</option>
                <option value="NAHARA">Nahara</option>
                <option value="UENOS">Uenos</option>
                <option value="LAINNYA">Lainnya</option>
              </select>
            </div>
            <div>
              <label class="text-xs text-emerald-300/60 uppercase tracking-wider mb-1 block">Nomor Unit *</label>
              <input type="text" id="pickup-unit" class="input-field w-full" placeholder="Contoh: 1/5 atau B3/12">
            </div>
            <div>
              <label class="text-xs text-emerald-300/60 uppercase tracking-wider mb-1 block">Nomor HP <span class="text-emerald-300/30">(opsional)</span></label>
              <input type="tel" id="pickup-phone" class="input-field w-full" placeholder="08xxxxxxxxxx">
            </div>
          </div>

          <button class="btn-primary w-full mt-6" onclick="startSession()">
            Mulai Sesi Pickup
          </button>

          <div class="mt-4 text-center">
            <a href="/scanner.html" class="text-xs text-emerald-300/40 hover:text-emerald-300/60">
              ← Kembali ke Scanner Hari H
            </a>
          </div>
        </div>
      </div>

      <!-- State 2: Sesi aktif -->
      <div id="session-section" style="display:none">

        <!-- Session header -->
        <div class="glass-card p-4 mb-4">
          <div class="flex items-center justify-between">
            <div>
              <div class="text-xs text-emerald-300/50 uppercase tracking-wider">Sesi Aktif</div>
              <div class="font-bold text-emerald-200 text-lg" id="session-label">-</div>
              <div class="text-xs text-emerald-300/50" id="session-phone"></div>
            </div>
            <div class="text-right">
              <div class="text-3xl font-bold text-emerald-400" id="session-count">0</div>
              <div class="text-xs text-emerald-300/50">voucher diambil</div>
            </div>
          </div>
        </div>

        <!-- Scan results list -->
        <div class="glass-card p-4 mb-4" id="scan-list-card" style="display:none">
          <h4 class="text-xs text-emerald-300/50 uppercase tracking-wider mb-3">Voucher Diambil</h4>
          <div id="scan-list" class="space-y-2"></div>
        </div>

        <!-- Scanner -->
        <div class="glass-card p-6 mb-4">
          <h3 class="text-center font-semibold text-emerald-200 mb-4">Arahkan kamera ke QR Code voucher</h3>
          <div class="scanner-container mb-4">
            <div id="qr-reader" style="width:100%"></div>
          </div>
          <div class="flex gap-3 justify-center">
            <button class="btn-primary" id="start-btn" onclick="startScanner()">
              <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z"/>
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 13a3 3 0 11-6 0 3 3 0 016 0z"/>
              </svg>
              Mulai Scan
            </button>
            <button class="btn-secondary" id="stop-btn" onclick="stopScanner()" style="display:none">Stop</button>
          </div>
          <!-- Manual input -->
          <div class="mt-4 pt-4 border-t border-white/10">
            <p class="text-xs text-emerald-300/40 text-center mb-2">Atau masukkan kode manual:</p>
            <div class="flex gap-2">
              <input type="text" id="manual-code" class="input-field" placeholder="QRB-1447H-...">
              <button class="btn-primary" onclick="manualPickup()">Catat</button>
            </div>
          </div>
        </div>

        <button class="btn-secondary w-full" onclick="endSession()">
          Selesai / Ganti Penerima
        </button>
      </div>

    </div>
  </main>

  <script src="/js/app.js"></script>
  <script>
    if (!requireAuth()) throw new Error('Not authenticated');
    initSidebar('scanner-pickup');

    let html5QrCode = null;
    let isScanning = false;
    let sessionActive = false;
    let sessionCluster = '';
    let sessionUnit = '';
    let sessionPhone = '';
    let sessionScans = [];

    const CLUSTER_LABELS = {
      MARGATA: 'Margata',
      NAHARA: 'Nahara',
      UENOS: 'Uenos',
      LAINNYA: 'Lainnya',
    };

    function startSession() {
      const cluster = document.getElementById('pickup-cluster').value;
      const unit = document.getElementById('pickup-unit').value.trim();
      const phone = document.getElementById('pickup-phone').value.trim();

      if (!cluster) { showToast('Pilih cluster terlebih dahulu', 'error'); return; }
      if (!unit) { showToast('Nomor unit wajib diisi', 'error'); return; }

      sessionCluster = cluster;
      sessionUnit = unit;
      sessionPhone = phone;
      sessionScans = [];

      document.getElementById('session-label').textContent =
        `${CLUSTER_LABELS[cluster] || cluster} ${unit}`;
      document.getElementById('session-phone').textContent =
        phone ? `📱 ${phone}` : '';
      document.getElementById('session-count').textContent = '0';
      document.getElementById('scan-list-card').style.display = 'none';
      document.getElementById('scan-list').innerHTML = '';

      document.getElementById('form-section').style.display = 'none';
      document.getElementById('session-section').style.display = 'block';
      sessionActive = true;

      startScanner();
    }

    function endSession() {
      stopScanner();
      sessionActive = false;
      document.getElementById('session-section').style.display = 'none';
      document.getElementById('form-section').style.display = 'block';
    }

    function startScanner() {
      if (isScanning) return;
      html5QrCode = new Html5Qrcode('qr-reader');
      html5QrCode.start(
        { facingMode: 'environment' },
        { fps: 10, qrbox: { width: 250, height: 250 } },
        onScanSuccess,
        () => {}
      ).then(() => {
        isScanning = true;
        document.getElementById('start-btn').style.display = 'none';
        document.getElementById('stop-btn').style.display = 'inline-flex';
      }).catch(err => {
        showToast('Tidak dapat mengakses kamera: ' + err, 'error');
      });
    }

    function stopScanner() {
      if (html5QrCode && isScanning) {
        html5QrCode.stop().then(() => {
          isScanning = false;
          document.getElementById('start-btn').style.display = 'inline-flex';
          document.getElementById('stop-btn').style.display = 'none';
        }).catch(() => {});
      }
    }

    async function onScanSuccess(decodedText) {
      // Pause scanner while processing
      if (html5QrCode && isScanning) {
        await html5QrCode.pause();
      }

      let voucherCode = decodedText;
      try {
        const parsed = JSON.parse(decodedText);
        if (parsed.code) voucherCode = parsed.code;
      } catch (e) { /* raw text */ }

      await pickupVoucher(voucherCode);

      // Resume scanner after processing
      if (html5QrCode && isScanning) {
        html5QrCode.resume();
      }
    }

    async function manualPickup() {
      const code = document.getElementById('manual-code').value.trim();
      if (!code) { showToast('Masukkan kode voucher', 'error'); return; }
      document.getElementById('manual-code').value = '';
      await pickupVoucher(code);
    }

    async function pickupVoucher(code) {
      // Prevent duplicate in same session
      if (sessionScans.find(s => s.code === code && s.success)) {
        showToast(`Voucher ${code} sudah dicatat dalam sesi ini`, 'error');
        return;
      }

      try {
        const result = await api('/vouchers/scan-pickup', {
          method: 'POST',
          body: JSON.stringify({
            voucherCode: code,
            pickupCluster: sessionCluster,
            pickupUnit: sessionUnit,
            pickupPhone: sessionPhone || undefined,
          }),
        });

        const scan = { code, success: true, time: new Date(), message: result.message };
        sessionScans.unshift(scan);
        updateSessionUI();
        showToast(`✅ ${code} berhasil dicatat`);

      } catch (err) {
        const scan = { code, success: false, time: new Date(), message: err.message };
        sessionScans.unshift(scan);
        updateSessionUI();
        showToast(err.message, 'error');
      }
    }

    function updateSessionUI() {
      const successCount = sessionScans.filter(s => s.success).length;
      document.getElementById('session-count').textContent = successCount;

      const listCard = document.getElementById('scan-list-card');
      if (sessionScans.length > 0) {
        listCard.style.display = 'block';
      }

      document.getElementById('scan-list').innerHTML = sessionScans.slice(0, 20).map(s => `
        <div class="flex items-center justify-between p-2 rounded-lg ${s.success ? 'bg-emerald-900/30' : 'bg-red-900/20'}">
          <div>
            <span class="font-mono text-sm ${s.success ? 'text-emerald-300' : 'text-red-300'}">${s.code}</span>
            <span class="text-xs text-emerald-300/30 ml-2">${s.time.toLocaleTimeString('id-ID')}</span>
          </div>
          <span class="text-xs ${s.success ? 'text-emerald-400' : 'text-red-400'}">${s.success ? '✅' : '❌'}</span>
        </div>
      `).join('');
    }
  </script>
</body>
</html>
```

- [ ] **Step 2: Commit**

```bash
git add client/scanner-pickup.html
git commit -m "feat: add scanner-pickup.html with session-based multi-scan UX"
```

---

## Task 7: Update scanner.html — add link to pickup scanner

**Files:**
- Modify: `client/scanner.html`

- [ ] **Step 1: Add link to pickup scanner**

In `client/scanner.html`, find the manual input section at the bottom of the scanner card (the section with "Atau masukkan kode manual:"). Add a link to the pickup scanner ABOVE the `<!-- Result -->` comment:

Find this block:
```html
      <!-- Result -->
```

Add before it:
```html
      <!-- Link to pickup scanner -->
      <div class="glass-card p-4 mb-4 text-center">
        <p class="text-sm text-emerald-300/60 mb-2">Mau mencatat pengambilan kupon oleh warga?</p>
        <a href="/scanner-pickup.html" class="btn-secondary inline-flex items-center gap-2">
          📦 Scanner Pickup Kupon
        </a>
      </div>
```

- [ ] **Step 2: Update `claimVoucher` to show pickup info if present**

In `client/scanner.html`, find the success result HTML inside `claimVoucher`:

```javascript
          <div class="flex justify-between py-1"><span class="text-emerald-300/50">Status:</span><span class="badge badge-claimed">DIKLAIM</span></div>
```

Replace the entire success `resultDiv.innerHTML` block with:

```javascript
        const pickupLine = result.pickupInfo
          ? `<div class="flex justify-between py-1 text-xs"><span class="text-emerald-300/50">Pickup:</span><span class="text-emerald-300/70">${result.pickupInfo}</span></div>`
          : '';
        resultDiv.innerHTML = `
          <div class="scan-success-icon">
            <svg class="w-10 h-10 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="3" d="M5 13l4 4L19 7"/></svg>
          </div>
          <h3 class="text-xl font-bold text-emerald-200 mb-2">Berhasil! ✅</h3>
          <p class="text-emerald-300/60 mb-4">${result.message}</p>
          <div class="glass-card p-4 text-left">
            <div class="flex justify-between py-1"><span class="text-emerald-300/50">Kode:</span><span class="font-mono font-bold">${result.voucher.voucherCode}</span></div>
            <div class="flex justify-between py-1"><span class="text-emerald-300/50">Status:</span><span class="badge badge-claimed">DIKLAIM</span></div>
            ${pickupLine}
          </div>
        `;
```

- [ ] **Step 3: Commit**

```bash
git add client/scanner.html
git commit -m "feat: add pickup scanner link and show pickup info in claim result"
```

---

## Task 8: Update vouchers.html — add DISTRIBUTED filter and badge

**Files:**
- Modify: `client/vouchers.html`

- [ ] **Step 1: Add DISTRIBUTED option to status filter**

Find:
```html
        <option value="ACTIVE">Aktif</option>
        <option value="CLAIMED">Diklaim</option>
        <option value="CANCELLED">Dibatalkan</option>
```

Replace with:
```html
        <option value="ACTIVE">Aktif</option>
        <option value="DISTRIBUTED">Sudah Diambil</option>
        <option value="CLAIMED">Diklaim</option>
        <option value="CANCELLED">Dibatalkan</option>
```

- [ ] **Step 2: Update status badge rendering**

Find the badge rendering in the table row:
```javascript
            <td><span class="badge badge-${v.status.toLowerCase()}">${v.status === 'ACTIVE' ? 'Aktif' : v.status === 'CLAIMED' ? 'Diklaim' : 'Batal'}</span></td>
```

Replace with:
```javascript
            <td><span class="badge badge-${v.status.toLowerCase()}">${
              v.status === 'ACTIVE' ? 'Aktif' :
              v.status === 'DISTRIBUTED' ? 'Diambil' :
              v.status === 'CLAIMED' ? 'Diklaim' : 'Batal'
            }</span></td>
```

- [ ] **Step 3: Add DISTRIBUTED to delete button condition (only ACTIVE can be deleted)**

The current code:
```javascript
              ${v.status === 'ACTIVE' ? `<button class="btn-danger btn-sm" onclick="deleteVoucher('${v.id}')">🗑</button>` : ''}
```

This already correctly allows delete only for `ACTIVE`, so no change needed.

- [ ] **Step 4: Commit**

```bash
git add client/vouchers.html
git commit -m "feat: add DISTRIBUTED filter option and badge to vouchers list"
```

---

## Task 9: Update dashboard.html — add Sudah Diambil stat tile

**Files:**
- Modify: `client/dashboard.html`

- [ ] **Step 1: Add distributedVouchers tile**

Find the stats grid section. The current tiles are: total, claimed, active, and one more. Find:

```html
      <div class="stat-card">
        <div class="stat-number" id="stat-claimed" style="background: linear-gradient(135deg, #93c5fd, #60a5fa); -webkit-background-clip: text; -webkit-text-fill-color: transparent;">-</div>
```

Add a new tile after the active tile (find `id="stat-active"` and add after its closing `</div></div>`):

```html
      <div class="stat-card">
        <div class="stat-number" id="stat-distributed" style="background: linear-gradient(135deg, #fbbf24, #f59e0b); -webkit-background-clip: text; -webkit-text-fill-color: transparent;">-</div>
        <div class="stat-label">Sudah Diambil</div>
        <div class="stat-sub">voucher pickup</div>
      </div>
```

- [ ] **Step 2: Wire up the distributed count**

Find where stats are rendered in the dashboard JS. After:
```javascript
        document.getElementById('stat-active').textContent = stats.activeVouchers;
```

Add:
```javascript
        document.getElementById('stat-distributed').textContent = stats.distributedVouchers ?? 0;
```

- [ ] **Step 3: Commit**

```bash
git add client/dashboard.html
git commit -m "feat: add Sudah Diambil tile to dashboard"
```

---

## Task 10: Data correction — fix test scan data

- [ ] **Step 1: Identify the 4 test vouchers**

```bash
PGPASSWORD=npg_rhz6HYVkjq2D psql \
  -h ep-sweet-hall-aony4lne-pooler.c-2.ap-southeast-1.aws.neon.tech \
  -U neondb_owner -d neondb \
  -c "
SELECT sl.id AS log_id, sl.voucher_id, v.voucher_code, sl.action, sl.scanned_at
FROM scan_logs sl
JOIN vouchers v ON v.id = sl.voucher_id
WHERE sl.scanned_by = 'e60f9c4b-60d4-4698-b93c-8783a0afa5da'
ORDER BY sl.scanned_at ASC;
"
```

Note the 4 voucher_ids in order of scan time.

- [ ] **Step 2: Reset voucher 3 and 4 back to ACTIVE (the ones not picked up by Pak Agam)**

The 2 oldest scans (13:10 and 13:34:07) are the ones to revert. Run:

```bash
PGPASSWORD=npg_rhz6HYVkjq2D psql \
  -h ep-sweet-hall-aony4lne-pooler.c-2.ap-southeast-1.aws.neon.tech \
  -U neondb_owner -d neondb \
  -c "
-- Reset the 2 vouchers NOT taken by Pak Agam back to ACTIVE
UPDATE vouchers SET
  status = 'ACTIVE',
  claimed_by = NULL,
  claimed_at = NULL
WHERE id IN (
  SELECT sl.voucher_id FROM scan_logs sl
  WHERE sl.scanned_by = 'e60f9c4b-60d4-4698-b93c-8783a0afa5da'
  ORDER BY sl.scanned_at ASC
  LIMIT 2
);
"
```

- [ ] **Step 3: Fix the 2 vouchers taken by Pak Agam — set to DISTRIBUTED**

First, find Pak Agam's pengkurban entry to get his address info (if available), then:

```bash
PGPASSWORD=npg_rhz6HYVkjq2D psql \
  -h ep-sweet-hall-aony4lne-pooler.c-2.ap-southeast-1.aws.neon.tech \
  -U neondb_owner -d neondb \
  -c "
-- Set the 2 most recent scans (by Pak Agam) to DISTRIBUTED
UPDATE vouchers SET
  status = 'DISTRIBUTED',
  claimed_by = NULL,
  claimed_at = NULL,
  pickup_cluster = 'MARGATA',
  pickup_unit = '?',
  picked_up_at = '2026-05-24 13:34:00',
  picked_up_by = 'e60f9c4b-60d4-4698-b93c-8783a0afa5da'
WHERE id IN (
  SELECT sl.voucher_id FROM scan_logs sl
  WHERE sl.scanned_by = 'e60f9c4b-60d4-4698-b93c-8783a0afa5da'
  ORDER BY sl.scanned_at DESC
  LIMIT 2
);
"
```

Replace `pickup_unit = '?'` with Pak Agam's actual unit number before running.

- [ ] **Step 4: Clean up CLAIMED scan_logs for the reverted vouchers, add PICKUP logs for Agam's**

```bash
PGPASSWORD=npg_rhz6HYVkjq2D psql \
  -h ep-sweet-hall-aony4lne-pooler.c-2.ap-southeast-1.aws.neon.tech \
  -U neondb_owner -d neondb \
  -c "
-- Update scan log action for Agam's 2 vouchers from CLAIMED to PICKUP
UPDATE scan_logs SET
  action = 'PICKUP',
  notes = 'Voucher diambil oleh Pak Agam (data dikoreksi manual)'
WHERE scanned_by = 'e60f9c4b-60d4-4698-b93c-8783a0afa5da'
  AND action = 'CLAIMED'
  AND scanned_at IN (
    SELECT scanned_at FROM scan_logs
    WHERE scanned_by = 'e60f9c4b-60d4-4698-b93c-8783a0afa5da'
    ORDER BY scanned_at DESC
    LIMIT 2
  );

-- Delete scan logs for the 2 reverted vouchers (ACTIVE ones)
DELETE FROM scan_logs
WHERE scanned_by = 'e60f9c4b-60d4-4698-b93c-8783a0afa5da'
  AND action = 'CLAIMED'
  AND scanned_at IN (
    SELECT scanned_at FROM scan_logs
    WHERE scanned_by = 'e60f9c4b-60d4-4698-b93c-8783a0afa5da'
    ORDER BY scanned_at ASC
    LIMIT 2
  );
"
```

- [ ] **Step 5: Verify**

```bash
PGPASSWORD=npg_rhz6HYVkjq2D psql \
  -h ep-sweet-hall-aony4lne-pooler.c-2.ap-southeast-1.aws.neon.tech \
  -U neondb_owner -d neondb \
  -c "SELECT v.voucher_code, v.status, v.pickup_cluster, v.pickup_unit FROM vouchers v JOIN scan_logs sl ON sl.voucher_id = v.id WHERE sl.scanned_by = 'e60f9c4b-60d4-4698-b93c-8783a0afa5da' GROUP BY v.id ORDER BY v.status;"
```

Expected: 2 rows with `DISTRIBUTED` (Pak Agam), 2 rows with `ACTIVE`.
