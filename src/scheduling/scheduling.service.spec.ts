import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { SchedulingService } from './scheduling.service';
import { Animal } from '../animals/animal.entity';
import { Pengkurban } from '../pengkurban/pengkurban.entity';
import { FormResponse } from '../form-responses/form-response.entity';
import { Event } from '../events/event.entity';

describe('SchedulingService.generateSchedule', () => {
  let service: SchedulingService;
  let animalRepo: any;
  let pengkurbanRepo: any;
  let formRepo: any;
  let eventRepo: any;

  beforeEach(async () => {
    animalRepo = {
      find: jest.fn(),
      findOne: jest.fn(),
      update: jest.fn().mockResolvedValue({ affected: 1 }),
      createQueryBuilder: jest.fn(),
    };
    pengkurbanRepo = {
      findOne: jest.fn(),
      find: jest.fn().mockResolvedValue([]),
    };
    formRepo = { findOne: jest.fn().mockResolvedValue(null) };
    eventRepo = {
      findOne: jest.fn().mockResolvedValue({
        id: 'event-1',
        startDate: new Date('2026-06-06T00:00:00+07:00'),
      }),
    };

    const m = await Test.createTestingModule({
      providers: [
        SchedulingService,
        { provide: getRepositoryToken(Animal), useValue: animalRepo },
        { provide: getRepositoryToken(Pengkurban), useValue: pengkurbanRepo },
        { provide: getRepositoryToken(FormResponse), useValue: formRepo },
        { provide: getRepositoryToken(Event), useValue: eventRepo },
      ],
    }).compile();
    service = m.get(SchedulingService);
  });

  it('returns zero counts when no animals', async () => {
    animalRepo.find.mockResolvedValue([]);
    const result = await service.generateSchedule('event-1');
    expect(result.teams.SAPI.total).toBe(0);
    expect(result.teams.KAMBING_DOMBA.total).toBe(0);
    expect(result.mismatches).toEqual([]);
  });

  it('separates animals into SAPI vs KAMBING_DOMBA teams', async () => {
    animalRepo.find.mockResolvedValue([
      {
        id: 'a1', animalCode: 'ANM-1', animalType: 'SAPI_PERORANGAN',
        eventId: 'event-1', pengkurbanId: 'pk1', isVendorAnimal: false,
      },
      {
        id: 'a2', animalCode: 'ANM-2', animalType: 'KAMBING',
        eventId: 'event-1', pengkurbanId: 'pk2', isVendorAnimal: false,
      },
    ]);
    pengkurbanRepo.findOne.mockImplementation((opts: any) =>
      Promise.resolve({
        id: opts.where.id, name: `pk-${opts.where.id}`,
        status: 'CONFIRMED', deletedAt: null,
      }),
    );
    const result = await service.generateSchedule('event-1');
    expect(result.teams.SAPI.total).toBe(1);
    expect(result.teams.KAMBING_DOMBA.total).toBe(1);
    expect(animalRepo.update).toHaveBeenCalled();
  });

  it('clears existing schedule before regenerating (call update with NULL fields first)', async () => {
    animalRepo.find.mockResolvedValue([]);
    await service.generateSchedule('event-1');
    expect(animalRepo.update).toHaveBeenCalledWith(
      { eventId: 'event-1' },
      expect.objectContaining({ scheduledAt: null, scheduledTeam: null }),
    );
  });

  it('throws NotFoundException when event missing', async () => {
    eventRepo.findOne.mockResolvedValue(null);
    await expect(service.generateSchedule('missing')).rejects.toThrow();
  });

  it('skips REJECTED pengkurban', async () => {
    animalRepo.find.mockResolvedValue([
      {
        id: 'a1', animalCode: 'ANM-1', animalType: 'KAMBING',
        eventId: 'event-1', pengkurbanId: 'pk-rejected', isVendorAnimal: false,
      },
    ]);
    pengkurbanRepo.findOne.mockResolvedValue({
      id: 'pk-rejected', name: 'Rejected', status: 'REJECTED', deletedAt: null,
    });
    const result = await service.generateSchedule('event-1');
    expect(result.teams.KAMBING_DOMBA.total).toBe(0);
  });

  it('includes vendor animals without preferensi', async () => {
    animalRepo.find.mockResolvedValue([
      {
        id: 'a1', animalCode: 'ANM-V', animalType: 'KAMBING',
        eventId: 'event-1', pengkurbanId: null, isVendorAnimal: true,
      },
    ]);
    const result = await service.generateSchedule('event-1');
    expect(result.teams.KAMBING_DOMBA.total).toBe(1);
  });
});
