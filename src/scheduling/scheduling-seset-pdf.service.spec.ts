import { Test } from '@nestjs/testing';
import { SchedulingSesetPdfService } from './scheduling-seset-pdf.service';
import { SchedulingService } from './scheduling.service';

describe('SchedulingSesetPdfService', () => {
  it('produces non-empty PDF buffer', async () => {
    const svc = {
      getSesetData: jest.fn().mockResolvedValue([
        {
          animal: {
            animalCode: 'ANM-1',
            animalType: 'SAPI_PERORANGAN',
            scheduledAt: new Date('2026-06-06T07:30:00+07:00'),
            scheduledTeam: 'SAPI',
          },
          sohibulRequests: [{
            name: 'Asep',
            phone: '0812',
            hak: 'Paha kanan',
            permintaanKhusus: 'Kaki',
            catatanSebagian: '',
            catatanPanitia: '',
          }],
        },
      ]),
    };
    const m = await Test.createTestingModule({
      providers: [
        SchedulingSesetPdfService,
        { provide: SchedulingService, useValue: svc },
      ],
    }).compile();
    const buf = await m.get(SchedulingSesetPdfService).generate('event-1');
    expect(buf.length).toBeGreaterThan(500);
    expect(buf.subarray(0, 4).toString()).toBe('%PDF');
  });
});
