import { PublicPengkurbanController } from './public-pengkurban.controller';
import { PricingCatalog } from '../common/pricing.constants';

describe('PublicPengkurbanController.getPricing', () => {
  let controller: PublicPengkurbanController;

  beforeEach(() => {
    controller = new PublicPengkurbanController({} as any);
  });

  it('returns infaq field per tier for domba/kambing', () => {
    const result = controller.getPricing();
    expect(result.domba[0].infaq).toBe(300_000);
    expect(result.kambing[0].infaq).toBe(300_000);
    expect(result.domba.every((t) => t.infaq === 300_000)).toBe(true);
    expect(result.kambing.every((t) => t.infaq === 300_000)).toBe(true);
  });

  it('returns infaq for sapi kolektif opsi A, B & C', () => {
    const result = controller.getPricing();
    expect(result.sapiKolektif.opsiA.infaq).toBe(300_000);
    expect(result.sapiKolektif.opsiB.infaq).toBe(300_000);
    expect(result.sapiKolektif.opsiC.infaq).toBe(300_000);
  });

  it('exposes opsiC pricing identik dengan opsiB (grouping label saja)', () => {
    const result = controller.getPricing();
    expect(result.sapiKolektif.opsiC.perOrang).toBe(
      result.sapiKolektif.opsiB.perOrang,
    );
    expect(result.sapiKolektif.opsiC.beratSapi).toBe(
      result.sapiKolektif.opsiB.beratSapi,
    );
    expect(result.sapiKolektif.opsiC.label).toBe('Sapi C');
  });

  it('returns infaq for sapi perorangan', () => {
    const result = controller.getPricing();
    expect(result.sapiPerorangan.infaq).toBe(1_750_000);
  });

  it('preserves backward-compat fields for daftar.html consumer', () => {
    const result: any = controller.getPricing();
    expect(result.infaqOperasional.dombaKambing).toBe(300_000);
    expect(result.infaqOperasional.sapiKolektifPerOrang).toBe(300_000);
    expect(result.infaqOperasional.sapiPerorangan).toBe(1_750_000);
    expect(result.sapiPerorangan.pricePerKg.min).toBe(65_000);
    expect(result.sapiPerorangan.pricePerKg.max).toBe(80_000);
    expect(result.rekening.bank).toBe('Bank Muamalat');
    expect(result.rekening.nomor).toBe('12 1010 4479');
    expect(result.rekening.atasNama).toBe('Masjid Al Hijrah CGE 11');
  });
});
