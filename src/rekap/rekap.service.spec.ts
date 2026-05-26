import { Test, TestingModule } from '@nestjs/testing';
import { RekapService } from './rekap.service';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Pengkurban } from '../pengkurban/pengkurban.entity';
import { Donation } from '../donations/donation.entity';

describe('RekapService', () => {
  let service: RekapService;
  const pengkurbanRepo = { find: jest.fn() };
  const donationRepo = { find: jest.fn() };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RekapService,
        { provide: getRepositoryToken(Pengkurban), useValue: pengkurbanRepo },
        { provide: getRepositoryToken(Donation), useValue: donationRepo },
      ],
    }).compile();
    service = module.get<RekapService>(RekapService);
  });

  afterEach(() => jest.clearAllMocks());

  const DEFAULT_INFAQ: Record<string, number> = {
    DOMBA: 300000,
    KAMBING: 300000,
    SAPI_KOLEKTIF: 300000,
    SAPI_KOLEKTIF_A: 300000,
    SAPI_KOLEKTIF_B: 300000,
    SAPI_KOLEKTIF_C: 300000,
    SAPI_PERORANGAN: 1750000,
  };

  const makePk = (overrides: Partial<Pengkurban> = {}): Pengkurban => {
    const animalType =
      overrides.animalType ?? ('SAPI_KOLEKTIF_A' as any);
    return {
      id: overrides.id ?? 'id-1',
      name: overrides.name ?? 'Nama',
      shohibulName: overrides.shohibulName ?? null,
      address: overrides.address ?? null,
      animalType,
      animalSize: overrides.animalSize ?? null,
      purchaseType: overrides.purchaseType ?? ('BELI_MASJID' as any),
      status: overrides.status ?? ('CONFIRMED' as any),
      infaqPaid: overrides.infaqPaid ?? false,
      infaqPaidAt: overrides.infaqPaidAt ?? null,
      infaqAmount:
        overrides.infaqAmount !== undefined
          ? overrides.infaqAmount
          : DEFAULT_INFAQ[animalType as string] ?? null,
      notes: overrides.notes ?? null,
      paymentProofPaths:
        (overrides as any).paymentProofPaths !== undefined
          ? (overrides as any).paymentProofPaths
          : null,
      createdAt: overrides.createdAt ?? new Date(0),
    } as Pengkurban;
  };

  const makeDonation = (overrides: Partial<Donation> = {}): Donation =>
    ({
      id: overrides.id ?? 'd-1',
      name: overrides.name ?? 'Donor',
      address: overrides.address ?? null,
      amount: overrides.amount ?? 100000,
      status: overrides.status ?? ('CONFIRMED' as any),
      paymentProofPaths:
        (overrides as any).paymentProofPaths !== undefined
          ? (overrides as any).paymentProofPaths
          : null,
      createdAt: overrides.createdAt ?? new Date(0),
    }) as Donation;

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('getDonasiRekap — merged ✅ rule', () => {
    it('pengkurban: ✅ unless status=PENDING_PAYMENT and infaqPaid=false; rejected skipped', async () => {
      pengkurbanRepo.find.mockResolvedValue([
        makePk({
          name: 'Confirmed Lunas',
          status: 'CONFIRMED' as any,
          infaqPaid: true,
        }),
        makePk({
          name: 'Confirmed Belum',
          status: 'CONFIRMED' as any,
          infaqPaid: false,
        }),
        makePk({
          name: 'Pending Verif',
          status: 'PENDING_VERIFICATION' as any,
          infaqPaid: false,
          paymentProofPaths: ['proof.jpg'] as any,
        }),
        makePk({
          name: 'Pending Lunas',
          status: 'PENDING_PAYMENT' as any,
          infaqPaid: true,
        }),
        makePk({
          name: 'Pending Belum',
          status: 'PENDING_PAYMENT' as any,
          infaqPaid: false,
        }),
        makePk({
          name: 'Rejected',
          status: 'REJECTED' as any,
          infaqPaid: false,
        }),
      ]);
      donationRepo.find.mockResolvedValue([]);

      const text = await service.getDonasiRekap();

      // Status != PENDING_PAYMENT → ✅
      expect(text).toContain('1. Confirmed Lunas 300 ribu ✅');
      expect(text).toContain('2. Confirmed Belum 300 ribu ✅');
      expect(text).toContain('3. Pending Verif 300 ribu ✅');
      // PENDING_PAYMENT tapi infaqPaid=true → tetap ✅
      expect(text).toContain('4. Pending Lunas 300 ribu ✅');
      // PENDING_PAYMENT + infaqPaid=false → no ✅
      expect(text).toContain('5. Pending Belum 300 ribu');
      expect(text).not.toContain('Pending Belum 300 ribu ✅');
      expect(text).not.toContain('Rejected');
    });

    it('donation: ✅ untuk semua non-REJECTED (CONFIRMED dan PENDING_VERIFICATION)', async () => {
      pengkurbanRepo.find.mockResolvedValue([]);
      donationRepo.find.mockResolvedValue([
        makeDonation({
          name: 'Donor A',
          amount: 500000,
          status: 'CONFIRMED' as any,
        }),
        makeDonation({
          name: 'Donor B',
          amount: 300000,
          status: 'PENDING_VERIFICATION' as any,
          paymentProofPaths: ['proof.jpg'] as any,
        }),
        makeDonation({
          name: 'Donor C',
          amount: 100000,
          status: 'REJECTED' as any,
        }),
      ]);

      const text = await service.getDonasiRekap();

      expect(text).toContain('1. Donor A 500 ribu ✅');
      expect(text).toContain('2. Donor B 300 ribu ✅');
      expect(text).not.toContain('Donor C');
    });

    it('pengkurban + donations merged ke 1 numbered list, urut createdAt ASC', async () => {
      pengkurbanRepo.find.mockResolvedValue([
        makePk({
          name: 'PK Awal',
          animalType: 'KAMBING' as any,
          createdAt: new Date('2026-04-01'),
          infaqPaid: true,
        }),
        makePk({
          name: 'PK Akhir',
          animalType: 'KAMBING' as any,
          createdAt: new Date('2026-04-10'),
          infaqPaid: true,
        }),
      ]);
      donationRepo.find.mockResolvedValue([
        makeDonation({
          name: 'Don Tengah',
          amount: 100000,
          createdAt: new Date('2026-04-05'),
        }),
      ]);

      const text = await service.getDonasiRekap();

      expect(text).toContain('1. PK Awal');
      expect(text).toContain('2. Don Tengah');
      expect(text).toContain('3. PK Akhir');
      expect(text).not.toContain('• Sohibul Qurban');
      expect(text).not.toContain('• Sukarela Warga');
    });

    it('hide nama untuk semua entry — output pakai blok aja (privacy)', async () => {
      pengkurbanRepo.find.mockResolvedValue([
        makePk({
          name: 'FixtureP',
          animalType: 'KAMBING' as any,
          address: 'Margata - M99/01',
          infaqPaid: true,
        }),
      ]);
      donationRepo.find.mockResolvedValue([
        makeDonation({
          name: 'FixtureD',
          amount: 250000,
          address: 'Margata - M99/02',
          status: 'CONFIRMED' as any,
          createdAt: new Date('2030-01-01'),
        }),
      ]);

      const text = await service.getDonasiRekap();

      expect(text).toContain('1. M99/01 300 ribu ✅');
      expect(text).toContain('2. M99/02 250 ribu ✅');
      expect(text).not.toContain('FixtureP');
      expect(text).not.toContain('FixtureD');
    });

    it('fallback ke nama kalau address null (blok kosong)', async () => {
      pengkurbanRepo.find.mockResolvedValue([
        makePk({
          name: 'FixtureNoAddr',
          animalType: 'KAMBING' as any,
          address: null,
          infaqPaid: true,
        }),
      ]);
      donationRepo.find.mockResolvedValue([
        makeDonation({
          name: 'FixtureDonorNoAddr',
          amount: 100000,
          address: null,
          status: 'CONFIRMED' as any,
          createdAt: new Date('2030-01-01'),
        }),
      ]);

      const text = await service.getDonasiRekap();

      expect(text).toContain('1. FixtureNoAddr 300 ribu ✅');
      expect(text).toContain('2. FixtureDonorNoAddr 100 ribu ✅');
    });

    it('formatRibu: ≥1jt pakai unit juta dengan 2 desimal max (no trailing zeros)', async () => {
      pengkurbanRepo.find.mockResolvedValue([]);
      donationRepo.find.mockResolvedValue([
        makeDonation({
          name: 'A',
          amount: 1_000_000,
          address: 'Margata - M99/01',
          createdAt: new Date('2030-01-01'),
        }),
        makeDonation({
          name: 'B',
          amount: 1_500_000,
          address: 'Margata - M99/02',
          createdAt: new Date('2030-01-02'),
        }),
        makeDonation({
          name: 'C',
          amount: 2_050_000,
          address: 'Margata - M99/03',
          createdAt: new Date('2030-01-03'),
        }),
        makeDonation({
          name: 'D',
          amount: 1_450_000,
          address: 'Margata - M99/04',
          createdAt: new Date('2030-01-04'),
        }),
      ]);

      const text = await service.getDonasiRekap();

      expect(text).toContain('1 juta');
      expect(text).toContain('1.5 juta');
      expect(text).toContain('2.05 juta');
      expect(text).toContain('1.45 juta');
      expect(text).not.toContain('1000 ribu');
      expect(text).not.toContain('2050 ribu');
    });

    it('merge entries dari orang yang sama (same blok + first name) — sum amount', async () => {
      pengkurbanRepo.find.mockResolvedValue([
        makePk({
          name: 'Sariah Sample',
          shohibulName: 'Sariah Sample binti Tester',
          animalType: 'SAPI_PERORANGAN' as any,
          address: 'Margata - M99/10',
          infaqPaid: true,
          createdAt: new Date('2026-04-01'),
        }),
      ]);
      donationRepo.find.mockResolvedValue([
        makeDonation({
          name: 'Sariah',
          amount: 50000,
          address: 'Margata - M99/10',
          status: 'CONFIRMED' as any,
          createdAt: new Date('2026-04-15'),
        }),
      ]);

      const text = await service.getDonasiRekap();

      // 1750rb infaq + 50rb donasi = 1.8 juta
      expect(text).toContain('1. M99/10 1.8 juta ✅');
      // Hanya 1 entry, bukan 2
      expect(text).not.toMatch(/2\. M99\/10/);
    });

    it('jangan merge orang berbeda walau blok sama (different first name)', async () => {
      pengkurbanRepo.find.mockResolvedValue([
        makePk({
          name: 'Aprilia Sample',
          animalType: 'KAMBING' as any,
          address: 'Margata - M99/20',
          infaqPaid: true,
          createdAt: new Date('2026-04-01'),
        }),
        makePk({
          name: 'Bagus Sample',
          animalType: 'KAMBING' as any,
          address: 'Margata - M99/20',
          infaqPaid: true,
          createdAt: new Date('2026-04-02'),
        }),
      ]);
      donationRepo.find.mockResolvedValue([]);

      const text = await service.getDonasiRekap();

      // Dua baris terpisah, blok sama
      expect(text).toContain('1. M99/20 300 ribu ✅');
      expect(text).toContain('2. M99/20 300 ribu ✅');
    });

    it('merge AND ✅: kalau salah satu piece belum ✅, merged entry juga belum ✅', async () => {
      pengkurbanRepo.find.mockResolvedValue([
        makePk({
          name: 'FixtureUnchecked',
          animalType: 'SAPI_PERORANGAN' as any,
          purchaseType: 'BAWA_SENDIRI' as any,
          infaqPaid: false,
          status: 'CONFIRMED' as any,
          address: 'Margata - M99/50',
        }),
      ]);
      donationRepo.find.mockResolvedValue([
        makeDonation({
          name: 'FixtureUnchecked',
          amount: 50000,
          address: 'Margata - M99/50',
          status: 'CONFIRMED' as any,
          createdAt: new Date('2030-01-01'),
        }),
      ]);

      const text = await service.getDonasiRekap();

      // Total amount sum: 1.75jt + 50rb = 1.8jt. Pengkurban no ✅, donation ✅.
      // AND merge → keseluruhan tidak ✅.
      expect(text).toContain('1. M99/50 1.8 juta');
      expect(text).not.toContain('1. M99/50 1.8 juta ✅');
    });

    it('merge skip honorific saat extract first name (H, Hj, Bin, Binti)', async () => {
      pengkurbanRepo.find.mockResolvedValue([
        makePk({
          name: 'H FixtureH bin Tester',
          shohibulName: 'H FixtureH bin Tester',
          animalType: 'KAMBING' as any,
          address: 'Margata - M99/30',
          infaqPaid: true,
        }),
      ]);
      donationRepo.find.mockResolvedValue([
        makeDonation({
          name: 'FixtureH',
          amount: 100000,
          address: 'Margata - M99/30',
          status: 'CONFIRMED' as any,
          createdAt: new Date('2030-01-01'),
        }),
      ]);

      const text = await service.getDonasiRekap();

      // Honorific "H" di-skip → keduanya match via "FixtureH" → merged
      expect(text).toContain('1. M99/30 400 ribu ✅');
    });

    it('renders blok + amount only (no name) when address tersedia', async () => {
      pengkurbanRepo.find.mockResolvedValue([
        makePk({
          name: 'FixtureP',
          animalType: 'SAPI_PERORANGAN' as any,
          address: 'Margata - Jl Margata 99 no 1 Test',
          infaqPaid: true,
        }),
      ]);
      donationRepo.find.mockResolvedValue([
        makeDonation({
          name: 'FixtureD',
          amount: 500000,
          address: 'Margata - M99/02',
          status: 'CONFIRMED' as any,
          createdAt: new Date('2030-01-01'),
        }),
      ]);

      const text = await service.getDonasiRekap();

      expect(text).toContain('1. M99/1 1.75 juta ✅');
      expect(text).toContain('2. M99/02 500 ribu ✅');
    });
  });

  describe('getDonasiRekap — infaq waiver via notes', () => {
    it('skips pengkurban with notes containing "infaq:potongan" from sohibul section', async () => {
      pengkurbanRepo.find.mockResolvedValue([
        makePk({ name: 'Cash Donor', animalType: 'SAPI_PERORANGAN' as any, infaqPaid: true }),
        makePk({
          name: 'Potongan Donor',
          animalType: 'SAPI_PERORANGAN' as any,
          purchaseType: 'BAWA_SENDIRI' as any,
          notes: 'Infaq via potongan daging. Marker: infaq:potongan',
          infaqPaid: true,
        }),
      ]);
      donationRepo.find.mockResolvedValue([]);

      const text = await service.getDonasiRekap();

      expect(text).toContain('1. Cash Donor 1.75 juta ✅');
      expect(text).not.toContain('Potongan Donor');
    });

    it('skips pengkurban with notes containing "infaq:waived" (institutional sumbangan)', async () => {
      pengkurbanRepo.find.mockResolvedValue([
        makePk({
          name: 'BPKH',
          animalType: 'KAMBING' as any,
          notes: 'Sumbangan institusional. Marker: infaq:waived',
        }),
      ]);
      donationRepo.find.mockResolvedValue([]);

      const text = await service.getDonasiRekap();

      expect(text).not.toContain('BPKH');
    });

    it('BAWA_SENDIRI ✅ rule: infaq_paid=true OR PENDING_VERIFICATION', async () => {
      pengkurbanRepo.find.mockResolvedValue([
        makePk({
          name: 'FixtureBawaUnpaidConfirmed',
          animalType: 'SAPI_PERORANGAN' as any,
          purchaseType: 'BAWA_SENDIRI' as any,
          infaqPaid: false,
          status: 'CONFIRMED' as any,
          address: 'Margata - M99/40',
        }),
        makePk({
          name: 'FixtureBawaPaid',
          animalType: 'SAPI_PERORANGAN' as any,
          purchaseType: 'BAWA_SENDIRI' as any,
          infaqPaid: true,
          status: 'CONFIRMED' as any,
          address: 'Margata - M99/41',
          createdAt: new Date('2030-01-01'),
        }),
        makePk({
          name: 'FixtureBawaPendingVerif',
          animalType: 'DOMBA' as any,
          purchaseType: 'BAWA_SENDIRI' as any,
          infaqPaid: false,
          status: 'PENDING_VERIFICATION' as any,
          address: 'Margata - M99/42',
          paymentProofPaths: ['proof.jpg'] as any,
          createdAt: new Date('2030-01-02'),
        }),
      ]);
      donationRepo.find.mockResolvedValue([]);

      const text = await service.getDonasiRekap();

      // CONFIRMED + infaq_paid=false: muncul tanpa ✅ (admin konfirm reg, infaq belum cash)
      expect(text).toContain('1. M99/40 1.75 juta');
      expect(text).not.toContain('1. M99/40 1.75 juta ✅');
      // infaq_paid=true: ✅
      expect(text).toContain('2. M99/41 1.75 juta ✅');
      // PENDING_VERIFICATION: ✅ (bukti udah diupload, finance pending)
      expect(text).toContain('3. M99/42 300 ribu ✅');
    });

    it('PENDING_VERIFICATION tanpa proof: no ✅ (intent declaration tanpa bukti transfer)', async () => {
      pengkurbanRepo.find.mockResolvedValue([]);
      donationRepo.find.mockResolvedValue([
        makeDonation({
          name: 'FixtureNoProof',
          amount: 50000,
          address: 'Margata - M99/60',
          status: 'PENDING_VERIFICATION' as any,
          paymentProofPaths: null as any,
          createdAt: new Date('2030-01-01'),
        }),
        makeDonation({
          name: 'FixtureWithProof',
          amount: 100000,
          address: 'Margata - M99/61',
          status: 'PENDING_VERIFICATION' as any,
          paymentProofPaths: ['x.jpg'] as any,
          createdAt: new Date('2030-01-02'),
        }),
      ]);

      const text = await service.getDonasiRekap();

      // No proof: tampil tanpa ✅
      expect(text).toContain('1. M99/60 50 ribu');
      expect(text).not.toContain('1. M99/60 50 ribu ✅');
      // With proof: ✅
      expect(text).toContain('2. M99/61 100 ribu ✅');
    });

    it('BELI_MASJID PENDING_VERIFICATION: ✅ (finance pending rekening koran)', async () => {
      pengkurbanRepo.find.mockResolvedValue([
        makePk({
          name: 'FixtureBeliPending',
          animalType: 'SAPI_KOLEKTIF_C' as any,
          purchaseType: 'BELI_MASJID' as any,
          infaqPaid: false,
          status: 'PENDING_VERIFICATION' as any,
          address: 'Margata - M99/50',
          paymentProofPaths: ['proof.jpg'] as any,
        }),
      ]);
      donationRepo.find.mockResolvedValue([]);

      const text = await service.getDonasiRekap();

      expect(text).toContain('1. M99/50 300 ribu ✅');
    });

    it('infaqAmount=null = waiver (di-skip dari rekap, source of truth baru)', async () => {
      pengkurbanRepo.find.mockResolvedValue([
        makePk({
          name: 'FixtureCash',
          animalType: 'KAMBING' as any,
          infaqAmount: 300000,
          address: 'Margata - M99/80',
        }),
        makePk({
          name: 'FixtureWaived',
          animalType: 'KAMBING' as any,
          infaqAmount: null,
          address: 'Margata - M99/81',
        }),
      ]);
      donationRepo.find.mockResolvedValue([]);

      const text = await service.getDonasiRekap();

      expect(text).toContain('1. M99/80 300 ribu');
      expect(text).not.toContain('M99/81');
      expect(text).not.toContain('FixtureWaived');
    });

    it('infaqAmount override (admin set partial amount)', async () => {
      pengkurbanRepo.find.mockResolvedValue([
        makePk({
          name: 'FixturePartial',
          animalType: 'SAPI_PERORANGAN' as any,
          infaqAmount: 500000,
          infaqPaid: true,
          address: 'Margata - M99/82',
        }),
      ]);
      donationRepo.find.mockResolvedValue([]);

      const text = await service.getDonasiRekap();

      // Pakai 500rb (override), bukan 1.75jt (default sapi perorangan)
      expect(text).toContain('1. M99/82 500 ribu ✅');
      expect(text).not.toContain('1.75 juta');
    });

    it('still includes pengkurban with non-marker notes', async () => {
      pengkurbanRepo.find.mockResolvedValue([
        makePk({
          name: 'Regular',
          animalType: 'KAMBING' as any,
          notes: 'Just some random verification note about transfer details',
        }),
      ]);
      donationRepo.find.mockResolvedValue([]);

      const text = await service.getDonasiRekap();

      expect(text).toContain('1. Regular 300 ribu');
    });

    it('does NOT filter notes that mention "infaq" and "tidak" without colon-marker (false-positive boundary)', async () => {
      pengkurbanRepo.find.mockResolvedValue([
        makePk({
          name: 'Cash Donor',
          animalType: 'KAMBING' as any,
          notes: 'Infaq sudah transfer. Bukti tidak terlampir, manual konfirmasi.',
        }),
      ]);
      donationRepo.find.mockResolvedValue([]);

      const text = await service.getDonasiRekap();

      expect(text).toContain('1. Cash Donor 300 ribu');
    });
  });

  describe('getDonasiRekap — footer', () => {
    it('includes rekening + donate link + dual phone', async () => {
      pengkurbanRepo.find.mockResolvedValue([]);
      donationRepo.find.mockResolvedValue([]);

      const text = await service.getDonasiRekap();

      expect(text).toContain(
        'Rekening Bank Muamalat | 12 1010 4479 a/n Masjid Al Hijrah CGE 11',
      );
      expect(text).toContain(
        'Donasi online: https://kurban.masjidalhijrahcge.id/donate.html',
      );
      expect(text).toContain('Fajar Firdaus (0812-7149-927)');
      expect(text).toContain('Panitia Kurban (0851-2151-9870)');
    });
  });

  describe('getPengkurbanRekap — ✅ logic', () => {
    it('✅ based on infaqPaid, not status', async () => {
      pengkurbanRepo.find.mockResolvedValue([
        makePk({
          name: 'Confirmed Lunas',
          animalType: 'SAPI_KOLEKTIF_A' as any,
          status: 'CONFIRMED' as any,
          infaqPaid: true,
        }),
        makePk({
          name: 'Confirmed Belum',
          animalType: 'SAPI_KOLEKTIF_A' as any,
          status: 'CONFIRMED' as any,
          infaqPaid: false,
        }),
        makePk({
          name: 'Pending Lunas',
          animalType: 'SAPI_KOLEKTIF_A' as any,
          status: 'PENDING_PAYMENT' as any,
          infaqPaid: true,
        }),
      ]);

      const text = await service.getPengkurbanRekap();

      expect(text).toContain('1. Confirmed Lunas ✅');
      expect(text).toContain('2. Confirmed Belum');
      expect(text).not.toContain('Confirmed Belum ✅');
      expect(text).toContain('3. Pending Lunas ✅');
    });
  });

  describe('getPengkurbanRekap — sapi kolektif tiers', () => {
    it('renders Sapi C section when there is SAPI_KOLEKTIF_C pengkurban', async () => {
      pengkurbanRepo.find.mockResolvedValue([
        makePk({ name: 'Adi', animalType: 'SAPI_KOLEKTIF_C' as any, infaqPaid: true }),
        makePk({ name: 'Bea', animalType: 'SAPI_KOLEKTIF_C' as any, infaqPaid: false }),
      ]);

      const text = await service.getPengkurbanRekap();

      expect(text).toContain('• Sapi C 320 - 350 Kg Rp 3.500.000 / orang');
      expect(text).toContain('1. Adi ✅');
      expect(text).toContain('2. Bea');
      expect(text).not.toContain('Bea ✅');
    });

    it('renders all three sapi kolektif sections in A → B → C order', async () => {
      pengkurbanRepo.find.mockResolvedValue([
        makePk({ name: 'C-person', animalType: 'SAPI_KOLEKTIF_C' as any }),
        makePk({ name: 'A-person', animalType: 'SAPI_KOLEKTIF_A' as any }),
        makePk({ name: 'B-person', animalType: 'SAPI_KOLEKTIF_B' as any }),
      ]);

      const text = await service.getPengkurbanRekap();

      const idxA = text.indexOf('Sapi A 350 - 400 Kg');
      const idxB = text.indexOf('Sapi B 320 - 350 Kg');
      const idxC = text.indexOf('Sapi C 320 - 350 Kg');
      expect(idxA).toBeGreaterThan(-1);
      expect(idxB).toBeGreaterThan(idxA);
      expect(idxC).toBeGreaterThan(idxB);
    });
  });

  describe('getPengkurbanRekap — kambing/domba tier', () => {
    it('shows tier from animalSize per row', async () => {
      pengkurbanRepo.find.mockResolvedValue([
        makePk({
          name: 'Hadi',
          animalType: 'DOMBA' as any,
          animalSize: 'Tipe A',
          infaqPaid: false,
        }),
        makePk({
          name: 'Siti',
          animalType: 'KAMBING' as any,
          animalSize: 'Tipe B',
          infaqPaid: true,
        }),
        makePk({
          name: 'Budi',
          animalType: 'KAMBING' as any,
          animalSize: null,
          infaqPaid: false,
        }),
      ]);

      const text = await service.getPengkurbanRekap();

      expect(text).toContain('1. Hadi (Domba - Tipe A)');
      expect(text).toContain('2. Siti (Kambing - Tipe B) ✅');
      expect(text).toContain('3. Budi (Kambing)');
      expect(text).not.toContain('Budi (Kambing - null)');
      expect(text).not.toContain('Budi (Kambing - )');
    });
  });

  describe('getPengkurbanRekap — info pemesanan section', () => {
    const ORIGINAL_ENV = process.env.REKAP_INFO_PEMESANAN;
    afterEach(() => {
      if (ORIGINAL_ENV === undefined) {
        delete process.env.REKAP_INFO_PEMESANAN;
      } else {
        process.env.REKAP_INFO_PEMESANAN = ORIGINAL_ENV;
      }
    });

    it('renders section when REKAP_INFO_PEMESANAN env is set', async () => {
      process.env.REKAP_INFO_PEMESANAN = 'TEST_INFO_BLOCK_MARKER\nLine 2';
      pengkurbanRepo.find.mockResolvedValue([
        makePk({ name: 'Test', animalType: 'KAMBING' as any }),
      ]);

      const text = await service.getPengkurbanRekap();

      expect(text).toContain('TEST_INFO_BLOCK_MARKER');
      expect(text).toContain('Line 2');
      expect(text.indexOf('TEST_INFO_BLOCK_MARKER')).toBeLessThan(
        text.indexOf('Jazakumullahu Khairan.'),
      );
    });

    it('skips section when REKAP_INFO_PEMESANAN env is unset', async () => {
      delete process.env.REKAP_INFO_PEMESANAN;
      pengkurbanRepo.find.mockResolvedValue([
        makePk({ name: 'Test', animalType: 'KAMBING' as any }),
      ]);

      const text = await service.getPengkurbanRekap();

      expect(text).not.toContain('Informasi Pemesanan');
      expect(text).not.toContain('TEST_INFO_BLOCK_MARKER');
    });

    it('skips section when REKAP_INFO_PEMESANAN env is empty/whitespace', async () => {
      process.env.REKAP_INFO_PEMESANAN = '   ';
      pengkurbanRepo.find.mockResolvedValue([
        makePk({ name: 'Test', animalType: 'KAMBING' as any }),
      ]);

      const text = await service.getPengkurbanRekap();

      expect(text).not.toContain('Informasi Pemesanan');
    });
  });

  describe('getPengkurbanRekap — address rendering', () => {
    it('appends short blok between name and ✅ for kolektif, perorangan, kambing/domba', async () => {
      pengkurbanRepo.find.mockResolvedValue([
        makePk({
          name: 'FixtureK',
          animalType: 'SAPI_KOLEKTIF_B' as any,
          address: 'Nahara Timur - 9/99',
          infaqPaid: true,
        }),
        makePk({
          name: 'FixtureP',
          animalType: 'SAPI_PERORANGAN' as any,
          address: 'Margata - Jl Margata 99 no 1 Test',
          infaqPaid: true,
        }),
        makePk({
          name: 'FixtureD',
          animalType: 'DOMBA' as any,
          animalSize: 'Tipe A',
          address: 'Margata - M99/02',
          infaqPaid: true,
        }),
      ]);

      const text = await service.getPengkurbanRekap();

      expect(text).toContain('1. FixtureK NHT 9/99 ✅');
      expect(text).toContain('1. FixtureP M99/1 ✅');
      expect(text).toContain('1. FixtureD (Domba - Tipe A) M99/02 ✅');
    });

    it('omits address segment when address is null/empty', async () => {
      pengkurbanRepo.find.mockResolvedValue([
        makePk({
          name: 'NoAddr',
          animalType: 'SAPI_KOLEKTIF_A' as any,
          address: null,
          infaqPaid: true,
        }),
      ]);

      const text = await service.getPengkurbanRekap();

      expect(text).toContain('1. NoAddr ✅');
      expect(text).not.toMatch(/NoAddr\s+\S+\s+✅/);
    });

    it.each([
      ['Margata - Margata - M3/36', 'M3/36'], // duplicate prefix
      ['M3/1', 'M3/1'], // bare blok
      ['MGT 3', 'M3'], // MGT bare → M
      ['MGT 6/28', 'M6/28'], // MGT with slash → M
      ['Margata - MGT 5/17', 'M5/17'], // Margata - MGT prefix
      ['Margata 5/9', 'M5/9'], // Margata X/Y form (no "no" keyword)
      ['Nahara - NHT 6/5', 'NHT 6/5'], // does NOT become "NHT NHT 6/5"
      ['Nahara - NHT8-16', 'NHT 8/16'], // dash separator → slash
      ['Nahara - 8-16', 'NHT 8/16'], // no NHT prefix, dash → slash
      ['Uenos 5 / 57', 'U5/57'], // spaces around slash
    ])('renders %j as "Pengguna %s"', async (addr, expected) => {
      pengkurbanRepo.find.mockResolvedValue([
        makePk({
          name: 'Pengguna',
          animalType: 'SAPI_KOLEKTIF_A' as any,
          address: addr,
          infaqPaid: false,
        }),
      ]);

      const text = await service.getPengkurbanRekap();
      expect(text).toContain(`1. Pengguna ${expected}`);
    });
  });

  describe('getPengkurbanRekap — open invite slot', () => {
    it('adds "N+1. ..." after last sapi perorangan when list non-empty', async () => {
      pengkurbanRepo.find.mockResolvedValue([
        makePk({ name: 'A', animalType: 'SAPI_PERORANGAN' as any }),
        makePk({ name: 'B', animalType: 'SAPI_PERORANGAN' as any }),
      ]);

      const text = await service.getPengkurbanRekap();

      expect(text).toContain('1. A');
      expect(text).toContain('2. B');
      expect(text).toContain('3. ...');
      // Exactly one invite slot, not two
      expect(text).not.toContain('4. ...');
    });

    it('adds "N+1. ..." after last kambing/domba when list non-empty', async () => {
      pengkurbanRepo.find.mockResolvedValue([
        makePk({ name: 'A', animalType: 'KAMBING' as any }),
        makePk({ name: 'B', animalType: 'DOMBA' as any }),
        makePk({ name: 'C', animalType: 'KAMBING' as any }),
      ]);

      const text = await service.getPengkurbanRekap();

      expect(text).toContain('1. A (Kambing)');
      expect(text).toContain('2. B (Domba)');
      expect(text).toContain('3. C (Kambing)');
      expect(text).toContain('4. ...');
    });

    it('does NOT add open slot to kolektif sections (slot count fixed at 7)', async () => {
      pengkurbanRepo.find.mockResolvedValue([
        makePk({ name: 'A', animalType: 'SAPI_KOLEKTIF_A' as any }),
        makePk({ name: 'B', animalType: 'SAPI_KOLEKTIF_A' as any }),
      ]);

      const text = await service.getPengkurbanRekap();
      // Sapi A header → 1. A, 2. B, 3-7. ... (5 placeholders, no 8th line)
      expect(text).toContain('7. ...');
      expect(text).not.toContain('8. ...');
    });

    it('preserves existing empty-list placeholders (1-3) when list empty', async () => {
      pengkurbanRepo.find.mockResolvedValue([]);

      const text = await service.getPengkurbanRekap();
      // Empty pengkurban → empty perorangan + kambing/domba → both show 1./2./3. ...
      expect(text).toContain('Qurban Sapi perorangan');
      expect(text).toContain('Qurban Kambing dan Domba');
      expect(text).toContain('1. ...');
      expect(text).toContain('2. ...');
      expect(text).toContain('3. ...');
      // No invite-slot N+1 in empty case (else branch handles it)
      expect(text).not.toContain('4. ...');
    });
  });

  describe('REKAP_REKENING env var', () => {
    const ORIGINAL_ENV = process.env.REKAP_REKENING;
    afterEach(() => {
      if (ORIGINAL_ENV === undefined) {
        delete process.env.REKAP_REKENING;
      } else {
        process.env.REKAP_REKENING = ORIGINAL_ENV;
      }
    });

    it('getPengkurbanRekap includes Pembayaran section with default rekening when env unset', async () => {
      delete process.env.REKAP_REKENING;
      pengkurbanRepo.find.mockResolvedValue([
        makePk({ name: 'Test', animalType: 'KAMBING' as any }),
      ]);

      const text = await service.getPengkurbanRekap();

      expect(text).toContain('Pembayaran:');
      expect(text).toContain(
        'Rekening Bank Muamalat | 12 1010 4479 a/n Masjid Al Hijrah CGE 11',
      );
      expect(text.indexOf('Pembayaran:')).toBeLessThan(
        text.indexOf('Jazakumullahu Khairan.'),
      );
    });

    it('getPengkurbanRekap Pembayaran reflects REKAP_REKENING when env set', async () => {
      process.env.REKAP_REKENING = 'Rekening BCA | 12345 a/n Test Override';
      pengkurbanRepo.find.mockResolvedValue([
        makePk({ name: 'Test', animalType: 'KAMBING' as any }),
      ]);

      const text = await service.getPengkurbanRekap();

      expect(text).toContain('Pembayaran:');
      expect(text).toContain('Rekening BCA | 12345 a/n Test Override');
      expect(text).not.toContain('Bank Muamalat');
    });

    it('getDonasiRekap rekening line reflects REKAP_REKENING when env set', async () => {
      process.env.REKAP_REKENING = 'Rekening BCA | 12345 a/n Test Override';
      pengkurbanRepo.find.mockResolvedValue([]);
      donationRepo.find.mockResolvedValue([]);

      const text = await service.getDonasiRekap();

      expect(text).toContain('Rekening BCA | 12345 a/n Test Override');
      expect(text).not.toContain('Bank Muamalat');
    });

    it('getDonasiRekap rekening falls back to default when env unset', async () => {
      delete process.env.REKAP_REKENING;
      pengkurbanRepo.find.mockResolvedValue([]);
      donationRepo.find.mockResolvedValue([]);

      const text = await service.getDonasiRekap();

      expect(text).toContain(
        'Rekening Bank Muamalat | 12 1010 4479 a/n Masjid Al Hijrah CGE 11',
      );
    });
  });
});
