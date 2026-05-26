import {
  parsePreferensiTime,
  assignSlots,
  PreferensiTime,
  extractPermintaan,
  summarizePermintaan,
  Permintaan,
} from './scheduling-mappers';

describe('parsePreferensiTime', () => {
  it.each([
    ['Jam 07.00 sd.07.30', { hour: 7, minute: 0 }],
    ['Jam 07.30 sd 08.00', { hour: 7, minute: 30 }],
    ['Jam 08.30 sd 09.00', { hour: 8, minute: 30 }],
    ['Jam 12.00 sd 12.30', { hour: 12, minute: 0 }],
  ])('parses %j', (input, expected) => {
    expect(parsePreferensiTime(input as string)).toEqual(expected);
  });

  it.each([
    ['', null],
    [null, null],
    [undefined, null],
    ['jam invalid', null],
    ['Jam 25.00 sd 25.30', null],
    ['Jam ab.cd sd ef.gh', null],
  ])('returns null for %j', (input, expected) => {
    expect(parsePreferensiTime(input as any)).toEqual(expected);
  });
});

describe('assignSlots', () => {
  const eventDate = new Date('2026-06-06T00:00:00+07:00'); // 00:00 WIB Idul Adha

  function input(
    items: Array<{ id: string; pref?: PreferensiTime | null }>,
  ) {
    return items.map((i) => ({ id: i.id, preferensi: i.pref ?? null }));
  }

  it('returns empty slots when no animals', () => {
    expect(assignSlots([], eventDate)).toEqual([]);
  });

  it('assigns single animal preferring 07:00 to slot 07:30', () => {
    const slots = assignSlots(input([{ id: 'A', pref: { hour: 7, minute: 0 } }]), eventDate);
    expect(slots).toHaveLength(1);
    expect(slots[0].id).toBe('A');
    expect(slots[0].slotStart.getHours()).toBe(7);
    expect(slots[0].slotStart.getMinutes()).toBe(30);
  });

  it('honors preferensi 08:30 to slot 08:30 exactly', () => {
    const slots = assignSlots(input([{ id: 'A', pref: { hour: 8, minute: 30 } }]), eventDate);
    expect(slots[0].slotStart.getHours()).toBe(8);
    expect(slots[0].slotStart.getMinutes()).toBe(30);
    expect(slots[0].mismatch).toBeUndefined();
  });

  it('fills FLEX animals to earliest empty slots in input order', () => {
    const slots = assignSlots(input([{ id: 'A' }, { id: 'B' }]), eventDate);
    const byId = (id: string) => slots.find((s) => s.id === id)!;
    expect(byId('A').slotStart.getHours()).toBe(7);
    expect(byId('A').slotStart.getMinutes()).toBe(30);
    expect(byId('B').slotStart.getHours()).toBe(7);
    expect(byId('B').slotStart.getMinutes()).toBe(45);
  });

  it('places A=07:30 and B (same pref 07:00) to next slot 07:45', () => {
    const slots = assignSlots(
      input([
        { id: 'A', pref: { hour: 7, minute: 0 } },
        { id: 'B', pref: { hour: 7, minute: 0 } },
      ]),
      eventDate,
    );
    const byId = (id: string) => slots.find((s) => s.id === id)!;
    expect(byId('A').slotStart.getMinutes()).toBe(30);
    expect(byId('B').slotStart.getMinutes()).toBe(45);
  });

  it('extends slot grid past default 18 when animals exceed', () => {
    const many = input(Array.from({ length: 20 }, (_, i) => ({ id: `A${i}` })));
    const slots = assignSlots(many, eventDate);
    expect(slots).toHaveLength(20);
    const last = slots[slots.length - 1].slotStart;
    expect(last.getHours()).toBe(12);
    expect(last.getMinutes()).toBe(15);
  });

  it('flags mismatch when preferensi > 60 min off scheduled', () => {
    // 19 animals all preferring 07:00 — slots from 07:30 onward
    // The 5th and later animals will be at 08:30+ which is >60 min off 07:00
    const many = input(
      Array.from({ length: 19 }, (_, i) => ({
        id: `A${i}`,
        pref: { hour: 7, minute: 0 },
      })),
    );
    const slots = assignSlots(many, eventDate);
    const lateOnes = slots.filter((s) => s.mismatch);
    expect(lateOnes.length).toBeGreaterThan(0);
  });

  it('places bucketed before FLEX even if FLEX submitted first', () => {
    // Test buckets sorted ascending, FLEX last
    const slots = assignSlots(
      input([
        { id: 'F' },
        { id: 'B', pref: { hour: 9, minute: 0 } },
        { id: 'A', pref: { hour: 7, minute: 0 } },
      ]),
      eventDate,
    );
    const byId = (id: string) => slots.find((s) => s.id === id)!;
    // A (pref 07:00) gets earliest slot 07:30
    expect(byId('A').slotStart.getMinutes()).toBe(30);
    expect(byId('A').slotStart.getHours()).toBe(7);
    // B (pref 09:00) gets 09:00 (free)
    expect(byId('B').slotStart.getHours()).toBe(9);
    expect(byId('B').slotStart.getMinutes()).toBe(0);
    // F (FLEX) fills second-earliest empty slot 07:45
    expect(byId('F').slotStart.getHours()).toBe(7);
    expect(byId('F').slotStart.getMinutes()).toBe(45);
  });
});

describe('extractPermintaan', () => {
  it('extracts all 4 fields from full form data', () => {
    const data = {
      'Hak daging qurban untuk Sohibul Qurban': 'Ambil Hak Paha Kanan untuk hewan qurban perorangan',
      'Permintaan khusus untuk bagian tertentu untuk Sohibul Qurban': 'Kaki, Ekor',
      'Catatan pengambilan hak sebagian': 'Paha kanan 4kg',
      'Catatan Khusus untuk Panitia': 'Tolong bagian has dalam',
    };
    expect(extractPermintaan(data)).toEqual({
      hak: 'Ambil Hak Paha Kanan untuk hewan qurban perorangan',
      permintaanKhusus: 'Kaki, Ekor',
      catatanSebagian: 'Paha kanan 4kg',
      catatanPanitia: 'Tolong bagian has dalam',
      kehadiran: null,
    });
  });

  it('returns empty strings for missing fields', () => {
    expect(extractPermintaan({})).toEqual({
      hak: '',
      permintaanKhusus: '',
      catatanSebagian: '',
      catatanPanitia: '',
      kehadiran: null,
    });
  });

  it('handles null/undefined data', () => {
    expect(extractPermintaan(null as any)).toEqual({
      hak: '',
      permintaanKhusus: '',
      catatanSebagian: '',
      catatanPanitia: '',
      kehadiran: null,
    });
  });

  it('extracts kehadiran=hadir from "Saya akan hadir langsung"', () => {
    const data = { 'Kehadiran saat penyembelihan': 'Saya akan hadir langsung' };
    expect(extractPermintaan(data).kehadiran).toBe('hadir');
  });

  it('extracts kehadiran=tidak_hadir from "Saya tidak bisa hadir..."', () => {
    const data = { 'Kehadiran saat penyembelihan': 'Saya tidak bisa hadir — mohon dikirimkan video & foto' };
    expect(extractPermintaan(data).kehadiran).toBe('tidak_hadir');
  });

  it('trims whitespace', () => {
    const data = { 'Hak daging qurban untuk Sohibul Qurban': '   Paha kanan   ' };
    expect(extractPermintaan(data).hak).toBe('Paha kanan');
  });

  it('extracts hak when key has trailing newline + clarification (real form)', () => {
    const data = {
      'Hak daging qurban untuk Sohibul Qurban\nApakah anda akan mengambil hak daging anda?':
        'Ambil Hak Paha Kanan untuk hewan qurban perorangan',
    };
    expect(extractPermintaan(data).hak).toBe('Ambil Hak Paha Kanan untuk hewan qurban perorangan');
  });

  it('extracts permintaanKhusus by prefix even if key has suffix', () => {
    const data = {
      'Permintaan khusus untuk bagian tertentu untuk Sohibul Qurban': 'Kaki, Ekor',
    };
    expect(extractPermintaan(data).permintaanKhusus).toBe('Kaki, Ekor');
  });
});

describe('summarizePermintaan', () => {
  const empty: Permintaan = { hak: '', permintaanKhusus: '', catatanSebagian: '', catatanPanitia: '' };

  it('returns dash for all-empty', () => {
    expect(summarizePermintaan([empty])).toBe('—');
  });

  it('joins permintaan khusus + catatan sebagian for single sohibul', () => {
    const p: Permintaan = { ...empty, permintaanKhusus: 'Kaki', catatanSebagian: 'Paha kanan 4kg' };
    const out = summarizePermintaan([p]);
    expect(out).toContain('Kaki');
    expect(out).toContain('Paha kanan');
  });

  it('truncates long output to ~40 char (+ ellipsis)', () => {
    const long: Permintaan = {
      ...empty,
      permintaanKhusus: 'Kaki, ekor, lidah, has dalam, paha, iga, sandung lamur, kepala, jantung',
    };
    const out = summarizePermintaan([long]);
    expect(out.length).toBeLessThanOrEqual(43);
  });

  it('prefixes nama for kolektif (multiple sohibul)', () => {
    const a: Permintaan = { ...empty, name: 'Asep', permintaanKhusus: 'Kaki' };
    const b: Permintaan = { ...empty, name: 'Margono', permintaanKhusus: 'Has dalam' };
    const out = summarizePermintaan([a, b]);
    expect(out).toMatch(/Asep/);
    expect(out).toMatch(/Margono/);
  });
});
