import { Test } from '@nestjs/testing';
import { SchedulingPdfService } from './scheduling-pdf.service';
import { SchedulingService } from './scheduling.service';

describe('SchedulingPdfService', () => {
  it('produces non-empty PDF with Permintaan info', async () => {
    const schedulingService = {
      getSesetData: jest.fn().mockResolvedValue([
        {
          animal: {
            animalCode: 'ANM-1',
            animalType: 'SAPI_PERORANGAN',
            scheduledAt: new Date('2026-06-06T07:30:00+07:00'),
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
        SchedulingPdfService,
        { provide: SchedulingService, useValue: schedulingService },
      ],
    }).compile();
    const buf = await m.get(SchedulingPdfService).generate('event-1');
    expect(buf.length).toBeGreaterThan(500);
    expect(buf.subarray(0, 4).toString()).toBe('%PDF');
  });
});
