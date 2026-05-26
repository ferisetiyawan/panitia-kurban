import { parseReg, rowToData, parseTimestamp, buildPrefillUrl } from './mappers';

describe('parseReg', () => {
  it('extracts REG-XXXX-YYYY from name string', () => {
    expect(parseReg('Sohibul Test (REG-2026-0001)')).toBe('REG-2026-0001');
  });

  it('returns null when no REG present', () => {
    expect(parseReg('Sohibul Test')).toBeNull();
  });

  it('returns null for empty / null / undefined input', () => {
    expect(parseReg('')).toBeNull();
    expect(parseReg(null)).toBeNull();
    expect(parseReg(undefined)).toBeNull();
  });

  it('returns first REG if multiple present', () => {
    expect(parseReg('REG-2026-0001 / REG-2026-0002')).toBe('REG-2026-0001');
  });
});

describe('rowToData', () => {
  it('maps headers to row values (parallel arrays)', () => {
    const headers = ['Timestamp', 'Nama', 'Pilihan'];
    const row = ['2026-05-19', 'Sohibul', '1/3'];
    expect(rowToData(headers, row)).toEqual({
      Timestamp: '2026-05-19',
      Nama: 'Sohibul',
      Pilihan: '1/3',
    });
  });

  it('preserves empty cell as empty string', () => {
    const headers = ['A', 'B', 'C'];
    const row = ['x', '', 'z'];
    expect(rowToData(headers, row)).toEqual({ A: 'x', B: '', C: 'z' });
  });

  it('pads missing cells with empty string when row shorter than headers', () => {
    const headers = ['A', 'B', 'C'];
    const row = ['x', 'y'];
    expect(rowToData(headers, row)).toEqual({ A: 'x', B: 'y', C: '' });
  });

  it('ignores empty header slots', () => {
    const headers = ['A', '', 'C'];
    const row = ['x', 'y', 'z'];
    expect(rowToData(headers, row)).toEqual({ A: 'x', C: 'z' });
  });
});

describe('parseTimestamp', () => {
  it('parses standard Google Forms timestamp (YYYY-MM-DD HH:MM:SS)', () => {
    const result = parseTimestamp('2026-05-19 14:23:45');
    expect(result instanceof Date).toBe(true);
    expect(result.getUTCFullYear()).toBe(2026);
    expect(result.getUTCMonth()).toBe(4); // May (0-indexed)
    expect(result.getUTCDate()).toBe(19);
  });

  it('parses slash-separated format', () => {
    const result = parseTimestamp('2026/05/19 14:23:45');
    expect(result.getUTCFullYear()).toBe(2026);
  });

  it('parses Google Sheets US-locale format M/D/YYYY H:MM:SS as WIB', () => {
    // Google Sheets default display format for many spreadsheets
    const result = parseTimestamp('5/17/2026 2:04:04');
    // 02:04:04 WIB = 2026-05-16T19:04:04Z (UTC)
    expect(result.toISOString()).toBe('2026-05-16T19:04:04.000Z');
  });

  it('parses US-locale with double-digit fields', () => {
    const result = parseTimestamp('12/31/2026 14:23:45');
    // 14:23:45 WIB = 2026-12-31T07:23:45Z (UTC)
    expect(result.toISOString()).toBe('2026-12-31T07:23:45.000Z');
  });

  it('throws on empty input', () => {
    expect(() => parseTimestamp('')).toThrow(/empty|invalid/i);
    expect(() => parseTimestamp(undefined)).toThrow(/empty|invalid/i);
  });

  it('throws on unparseable string', () => {
    expect(() => parseTimestamp('not-a-date')).toThrow(/invalid/i);
  });

  it('pins WIB offset: 14:23:45 WIB = 07:23:45 UTC', () => {
    const result = parseTimestamp('2026-05-19 14:23:45');
    expect(result.toISOString()).toBe('2026-05-19T07:23:45.000Z');
  });
});

describe('buildPrefillUrl', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env.KONFIRMASI_TEKNIS_FORM_PREFILL_BASE =
      'https://docs.google.com/forms/d/e/EXAMPLE_FORM/viewform';
    process.env.KONFIRMASI_TEKNIS_NAMA_ENTRY_ID = '123456';
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('builds URL with encoded nama parameter', () => {
    const url = buildPrefillUrl('Sohibul Test (REG-2026-0001)');
    expect(url).toContain('https://docs.google.com/forms/d/e/EXAMPLE_FORM/viewform');
    expect(url).toContain('usp=pp_url');
    expect(url).toContain('entry.123456=');
    expect(url).toContain('Sohibul');
    expect(url).toContain('REG-2026-0001');
  });

  it('encodes special characters in nama', () => {
    const url = buildPrefillUrl('Sohibul Test — Kambing #1 (REG-2026-0001)');
    expect(decodeURIComponent(url.split('=').pop()!)).toBe(
      'Sohibul Test — Kambing #1 (REG-2026-0001)',
    );
  });

  it('throws when env vars missing', () => {
    delete process.env.KONFIRMASI_TEKNIS_FORM_PREFILL_BASE;
    expect(() => buildPrefillUrl('x')).toThrow(/env/i);
  });
});
