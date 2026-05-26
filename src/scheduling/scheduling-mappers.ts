export interface PreferensiTime {
  hour: number;
  minute: number;
}

export function parsePreferensiTime(
  value: string | null | undefined,
): PreferensiTime | null {
  if (!value) return null;
  const match = value.match(/Jam\s+(\d{1,2})[.:](\d{2})/);
  if (!match) return null;
  const hour = parseInt(match[1], 10);
  const minute = parseInt(match[2], 10);
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return null;
  return { hour, minute };
}
