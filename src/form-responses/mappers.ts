const REG_REGEX = /REG-\d{4}-\d{4}/;

export function parseReg(text: string | null | undefined): string | null {
  if (!text) return null;
  const match = text.match(REG_REGEX);
  return match ? match[0] : null;
}

export function rowToData(
  headers: string[],
  row: string[],
): Record<string, string> {
  const data: Record<string, string> = {};
  for (let i = 0; i < headers.length; i++) {
    const header = headers[i];
    if (!header) continue;
    data[header] = row[i] ?? '';
  }
  return data;
}

// WIB = +07:00 (form submitter timezone; Google Forms reports timestamps in spreadsheet locale without offset)
const WIB_OFFSET = '+07:00';

export function parseTimestamp(value: string | undefined | null): Date {
  if (!value) throw new Error('Timestamp value is empty');
  const trimmed = value.trim();

  // Google Sheets returns timestamps in spreadsheet locale display format.
  // Observed formats (assume WIB = +07:00 since form is submitted from Indonesia):
  //   1. "M/D/YYYY H:MM:SS"   (US locale default — most common)
  //   2. "YYYY-MM-DD HH:MM:SS"
  //   3. "YYYY/MM/DD HH:MM:SS"
  //   4. Already-ISO with offset (passthrough)

  // Pattern 1: M/D/YYYY H:MM:SS — reorder to ISO
  const usFormat = trimmed.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})\s+(\d{1,2}):(\d{2}):(\d{2})$/);
  if (usFormat) {
    const [, m, d, y, h, mi, s] = usFormat;
    const iso = `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}T${h.padStart(2, '0')}:${mi}:${s}${WIB_OFFSET}`;
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) throw new Error(`Invalid timestamp: ${value}`);
    return date;
  }

  // Pattern 2/3: ISO-like or slash-separated. Normalize to ISO + WIB offset.
  const normalized = trimmed
    .replace(/\//g, '-')       // slashes → dashes
    .replace(' ', 'T')         // space → T (ISO separator)
    + (trimmed.includes('+') || trimmed.endsWith('Z') ? '' : WIB_OFFSET);

  const date = new Date(normalized);
  if (Number.isNaN(date.getTime())) {
    throw new Error(`Invalid timestamp: ${value}`);
  }
  return date;
}

export function buildPrefillUrl(namaWithReg: string): string {
  const base = process.env.KONFIRMASI_TEKNIS_FORM_PREFILL_BASE;
  const entryId = process.env.KONFIRMASI_TEKNIS_NAMA_ENTRY_ID;
  if (!base || !entryId) {
    throw new Error(
      'Missing env: KONFIRMASI_TEKNIS_FORM_PREFILL_BASE and/or KONFIRMASI_TEKNIS_NAMA_ENTRY_ID',
    );
  }
  const encoded = encodeURIComponent(namaWithReg);
  return `${base}?usp=pp_url&entry.${entryId}=${encoded}`;
}
