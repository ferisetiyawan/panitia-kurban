import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { PengkurbanService } from './pengkurban.service';
import { Pengkurban } from './pengkurban.entity';
import { FormResponse } from '../form-responses/form-response.entity';
import { WaNotifierService } from '../common/notifications/wa-notifier.service';

describe('PengkurbanService.exportCsv — waiver semantics', () => {
  let service: PengkurbanService;
  const pengkurbanRepo = { find: jest.fn() };
  const formResponseRepo = { find: jest.fn().mockResolvedValue([]) };
  const waNotifier = { notifyRegister: jest.fn() } as any;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PengkurbanService,
        { provide: getRepositoryToken(Pengkurban), useValue: pengkurbanRepo },
        { provide: getRepositoryToken(FormResponse), useValue: formResponseRepo },
        { provide: WaNotifierService, useValue: waNotifier },
      ],
    }).compile();
    service = module.get<PengkurbanService>(PengkurbanService);
  });

  afterEach(() => jest.clearAllMocks());

  const makePk = (overrides: Partial<Pengkurban> = {}): Pengkurban =>
    ({
      id: overrides.id ?? 'id-1',
      registrationNumber: overrides.registrationNumber ?? 'REG-2026-0001',
      name: overrides.name ?? 'Nama',
      shohibulName: overrides.shohibulName ?? null,
      address: overrides.address ?? 'Alamat',
      animalType: overrides.animalType ?? ('SAPI_PERORANGAN' as any),
      animalSize: overrides.animalSize ?? null,
      purchaseType: overrides.purchaseType ?? ('BELI_MASJID' as any),
      price: (overrides as any).price ?? null,
      status: overrides.status ?? ('CONFIRMED' as any),
      infaqPaid: overrides.infaqPaid ?? false,
      infaqPaidAt: overrides.infaqPaidAt ?? null,
      infaqAmount:
        overrides.infaqAmount !== undefined ? overrides.infaqAmount : 1750000,
      notes: overrides.notes ?? null,
      phone: overrides.phone ?? null,
      paymentProofPaths: (overrides as any).paymentProofPaths ?? null,
      createdAt: overrides.createdAt ?? new Date(0),
      event: (overrides as any).event ?? null,
    }) as Pengkurban;

  const csvRowFor = (csv: string, reg: string) =>
    csv.split('\n').find((line) => line.startsWith(`"${reg}"`));

  it('infaqAmount=null → CSV "Infaq Operasional" empty, "Status Infaq" = Waived', async () => {
    pengkurbanRepo.find.mockResolvedValue([
      makePk({
        registrationNumber: 'REG-2026-0020',
        name: 'Didin',
        infaqAmount: null,
        infaqPaid: false,
      }),
    ]);

    const csv = await service.exportCsv();
    const row = csvRowFor(csv, 'REG-2026-0020');

    expect(row).toBeDefined();
    const fields = row!.split('","').map((f) => f.replace(/^"|"$/g, ''));
    // Header order: ... Harga(7), Infaq Operasional(8), Status Infaq(9), ...
    expect(fields[8]).toBe(''); // infaq amount empty for waiver
    expect(fields[9]).toBe('Waived');
  });

  it('infaqAmount=500000 (override) → CSV "Infaq Operasional" = 500000', async () => {
    pengkurbanRepo.find.mockResolvedValue([
      makePk({
        registrationNumber: 'REG-2026-0099',
        name: 'Partial',
        infaqAmount: 500000,
        infaqPaid: true,
      }),
    ]);

    const csv = await service.exportCsv();
    const row = csvRowFor(csv, 'REG-2026-0099');

    expect(row).toBeDefined();
    const fields = row!.split('","').map((f) => f.replace(/^"|"$/g, ''));
    expect(fields[8]).toBe('500000');
    expect(fields[9]).toBe('Lunas');
  });

  it('infaqAmount=1750000 (default sapi perorangan) → CSV "Infaq Operasional" = 1750000', async () => {
    pengkurbanRepo.find.mockResolvedValue([
      makePk({
        registrationNumber: 'REG-2026-0018',
        name: 'Rahmat',
        infaqAmount: 1750000,
        infaqPaid: true,
      }),
    ]);

    const csv = await service.exportCsv();
    const row = csvRowFor(csv, 'REG-2026-0018');

    expect(row).toBeDefined();
    const fields = row!.split('","').map((f) => f.replace(/^"|"$/g, ''));
    expect(fields[8]).toBe('1750000');
    expect(fields[9]).toBe('Lunas');
  });
});
