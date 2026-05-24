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

  // ─── scan (accepts DISTRIBUTED) ──────────────────────────────

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

  // ─── stats (includes distributed) ────────────────────────────

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
