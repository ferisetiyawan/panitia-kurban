export interface TierPrice {
  size: string;
  weight: string;
  price?: number;
  priceMin?: number;
  priceMax?: number;
  priceNote?: string;
  infaq: number;
}

export interface SapiKolektifOption {
  perOrang: number;
  beratSapi: string;
  label: string;
  infaq: number;
}

export interface PricingCatalog {
  domba: TierPrice[];
  kambing: TierPrice[];
  sapiKolektif: {
    opsiA: SapiKolektifOption;
    opsiB: SapiKolektifOption;
    opsiC: SapiKolektifOption;
    orangPerEkor: number;
    jenisSapi: string;
  };
  sapiPerorangan: {
    pricePerKg: { min: number; max: number };
    infaq: number;
    note: string;
  };
  infaqOperasional: {
    dombaKambing: number;
    sapiKolektifPerOrang: number;
    sapiPerorangan: number;
  };
  rekening: {
    bank: string;
    nomor: string;
    atasNama: string;
  };
}

const INFAQ_KAMBING_DOMBA = 300_000;
const INFAQ_SAPI_KOLEKTIF = 300_000;
const INFAQ_SAPI_PERORANGAN = 1_750_000;

export const PRICING: PricingCatalog = {
  domba: [
    {
      size: 'Tipe A',
      weight: '30 kg',
      price: 2_950_000,
      infaq: INFAQ_KAMBING_DOMBA,
    },
    {
      size: 'Tipe B',
      weight: '40 kg',
      price: 3_950_000,
      infaq: INFAQ_KAMBING_DOMBA,
    },
    {
      size: 'Tipe C',
      weight: '50 kg',
      price: 4_950_000,
      infaq: INFAQ_KAMBING_DOMBA,
    },
    {
      size: 'Super',
      weight: '60-90 kg',
      priceMin: 5_600_000,
      priceMax: 9_000_000,
      infaq: INFAQ_KAMBING_DOMBA,
    },
    {
      size: 'Istimewa',
      weight: '>100 kg',
      priceNote: 'hubungi panitia',
      infaq: INFAQ_KAMBING_DOMBA,
    },
  ],
  kambing: [
    {
      size: 'Tipe A',
      weight: '30 kg',
      price: 3_000_000,
      infaq: INFAQ_KAMBING_DOMBA,
    },
    {
      size: 'Tipe B',
      weight: '40 kg',
      price: 3_950_000,
      infaq: INFAQ_KAMBING_DOMBA,
    },
    {
      size: 'Tipe C',
      weight: '50 kg',
      price: 5_000_000,
      infaq: INFAQ_KAMBING_DOMBA,
    },
    {
      size: 'Super',
      weight: '60-90 kg',
      priceMin: 5_650_000,
      priceMax: 9_200_000,
      infaq: INFAQ_KAMBING_DOMBA,
    },
    {
      size: 'Istimewa',
      weight: '>100 kg',
      priceNote: 'hubungi panitia',
      infaq: INFAQ_KAMBING_DOMBA,
    },
  ],
  sapiKolektif: {
    opsiA: {
      perOrang: 4_000_000,
      beratSapi: '350-400 kg',
      label: 'Sapi A',
      infaq: INFAQ_SAPI_KOLEKTIF,
    },
    opsiB: {
      perOrang: 3_500_000,
      beratSapi: '320-350 kg',
      label: 'Sapi B',
      infaq: INFAQ_SAPI_KOLEKTIF,
    },
    // opsiC: spec identik dengan opsiB. Murni grouping label — di grup WA
    // sapi kedua/ketiga di tier B di-sebut "Sapi C" (B-1, B-2 secara informal).
    opsiC: {
      perOrang: 3_500_000,
      beratSapi: '320-350 kg',
      label: 'Sapi C',
      infaq: INFAQ_SAPI_KOLEKTIF,
    },
    orangPerEkor: 7,
    jenisSapi: 'Sapi Bali',
  },
  sapiPerorangan: {
    pricePerKg: { min: 65_000, max: 80_000 },
    infaq: INFAQ_SAPI_PERORANGAN,
    note: 'Kisaran harga Rp 65.000 – 80.000/kg',
  },
  infaqOperasional: {
    dombaKambing: INFAQ_KAMBING_DOMBA,
    sapiKolektifPerOrang: INFAQ_SAPI_KOLEKTIF,
    sapiPerorangan: INFAQ_SAPI_PERORANGAN,
  },
  rekening: {
    bank: 'Bank Muamalat',
    nomor: '12 1010 4479',
    atasNama: 'Masjid Al Hijrah CGE 11',
  },
};
