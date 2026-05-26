import { Test } from '@nestjs/testing';
import { SchedulingBroadcastService } from './scheduling-broadcast.service';
import { SchedulingService } from './scheduling.service';

describe('SchedulingBroadcastService', () => {
  let service: SchedulingBroadcastService;
  let schedulingService: any;

  beforeEach(async () => {
    schedulingService = { getSchedule: jest.fn() };
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
          ? [{
              animal: { animalCode: 'ANM-1', animalType: 'SAPI_PERORANGAN', scheduledAt: new Date('2026-06-06T07:30:00+07:00') },
              pengkurban: [{ name: 'Asep' }],
            }]
          : [{
              animal: { animalCode: 'ANM-2', animalType: 'KAMBING', scheduledAt: new Date('2026-06-06T07:30:00+07:00') },
              pengkurban: [{ name: 'Haris' }],
            }],
      ),
    );
    const msg = await service.buildSohibulMessage('event-1');
    expect(msg).toContain('JADWAL PENYEMBELIHAN');
    expect(msg).toContain('Tim SAPI');
    expect(msg).toContain('07:30 — Asep');
    expect(msg).toContain('Tim KAMBING/DOMBA');
    expect(msg).toContain('07:30 — Haris');
    expect(msg).toContain('portal.html');
    expect(msg).toContain('Jazakumullahu khairan');
  });

  it('lists multiple sohibul names for kolektif animal', async () => {
    schedulingService.getSchedule.mockImplementation((eventId: string, team?: string) =>
      Promise.resolve(
        team === 'SAPI'
          ? [{
              animal: { animalCode: 'ANM-K', animalType: 'SAPI_KOLEKTIF_A', scheduledAt: new Date('2026-06-06T07:30:00+07:00') },
              pengkurban: [{ name: 'Asep' }, { name: 'Margono' }, { name: 'Sylvie' }],
            }]
          : [],
      ),
    );
    const msg = await service.buildSohibulMessage('event-1');
    expect(msg).toMatch(/Asep.*Margono.*Sylvie/);
    expect(msg).toContain('Sapi Kolektif A');
  });

  it('panitia message includes generatedBy + warnings when overflow/mismatches > 0', async () => {
    schedulingService.getSchedule.mockResolvedValue([]);
    const msg = await service.buildPanitiaMessage('event-1', {
      overflow: 4, mismatches: 3, generatedBy: 'Fajar',
    });
    expect(msg).toContain('Generated');
    expect(msg).toContain('Fajar');
    expect(msg).toContain('4 hewan overflow');
    expect(msg).toContain('3 preferensi');
  });

  it('resolveGroupJid prefers env var, falls back for panitia_group', () => {
    process.env.WA_SOHIBUL_GROUP_JID = 'abc@g.us';
    process.env.WA_PANITIA_GROUP_JID = '';
    process.env.WA_NOTIFY_PHONE = '628111';
    expect(service.resolveGroupJid('sohibul_group')).toBe('abc@g.us');
    expect(service.resolveGroupJid('panitia_group')).toBe('628111');
    delete process.env.WA_SOHIBUL_GROUP_JID;
    expect(service.resolveGroupJid('sohibul_group')).toBeNull();
  });
});
