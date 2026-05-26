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

export interface SchedulableInput<T = unknown> {
  id: string;
  preferensi: PreferensiTime | null;
  payload?: T;
}

export interface SlotAssignment<T = unknown> {
  id: string;
  payload?: T;
  slotStart: Date;
  mismatch?: { preferred: string; scheduled: string; reason: string };
}

const DEFAULT_SLOTS = 18;
const SLOT_MINUTES = 15;
const START_HOUR = 7;
const START_MINUTE = 30;
const MISMATCH_THRESHOLD_MINUTES = 60;

function fmtHHMM(hour: number, minute: number): string {
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

export function assignSlots<T = unknown>(
  inputs: SchedulableInput<T>[],
  eventDate: Date,
): SlotAssignment<T>[] {
  if (inputs.length === 0) return [];

  // Build initial 18-slot grid (all empty)
  const slots: Array<{ start: Date; taken: SchedulableInput<T> | null }> = [];
  const base = new Date(eventDate);
  base.setHours(START_HOUR, START_MINUTE, 0, 0);
  for (let i = 0; i < DEFAULT_SLOTS; i++) {
    slots.push({
      start: new Date(base.getTime() + i * SLOT_MINUTES * 60 * 1000),
      taken: null,
    });
  }

  // Bucket inputs by preferensi key ("HH:MM"); null preferensi → FLEX
  const bucketed = new Map<string, SchedulableInput<T>[]>();
  const flex: SchedulableInput<T>[] = [];
  for (const inp of inputs) {
    if (!inp.preferensi) {
      flex.push(inp);
      continue;
    }
    const key = fmtHHMM(inp.preferensi.hour, inp.preferensi.minute);
    if (!bucketed.has(key)) bucketed.set(key, []);
    bucketed.get(key)!.push(inp);
  }

  // Sort bucket keys ascending
  const sortedKeys = [...bucketed.keys()].sort();

  function ensureSlot(
    targetTime: Date | null,
  ): { start: Date; taken: SchedulableInput<T> | null } {
    if (targetTime) {
      // Find empty slot >= target first
      const chosen = slots.find(
        (s) => !s.taken && s.start.getTime() >= targetTime.getTime(),
      );
      if (chosen) return chosen;
      // Fallback: latest empty slot < target
      const earlier = [...slots]
        .filter((s) => !s.taken && s.start.getTime() < targetTime.getTime())
        .sort((a, b) => b.start.getTime() - a.start.getTime());
      if (earlier.length > 0) return earlier[0];
    } else {
      // FLEX: first empty slot
      const chosen = slots.find((s) => !s.taken);
      if (chosen) return chosen;
    }
    // Extend grid
    const last = slots[slots.length - 1];
    const next = {
      start: new Date(last.start.getTime() + SLOT_MINUTES * 60 * 1000),
      taken: null as SchedulableInput<T> | null,
    };
    slots.push(next);
    return next;
  }

  // Assign bucketed first, FLEX last
  for (const key of sortedKeys) {
    const [hour, minute] = key.split(':').map(Number);
    const target = new Date(eventDate);
    target.setHours(hour, minute, 0, 0);
    for (const inp of bucketed.get(key)!) {
      const slot = ensureSlot(target);
      slot.taken = inp;
    }
  }
  for (const inp of flex) {
    const slot = ensureSlot(null);
    slot.taken = inp;
  }

  // Build result, with mismatch detection (>60 min off preferensi)
  return slots
    .filter((s) => s.taken !== null)
    .map((s) => {
      const taken = s.taken!;
      const result: SlotAssignment<T> = {
        id: taken.id,
        payload: taken.payload,
        slotStart: s.start,
      };
      if (taken.preferensi) {
        const target = taken.preferensi.hour * 60 + taken.preferensi.minute;
        const actual = s.start.getHours() * 60 + s.start.getMinutes();
        if (Math.abs(actual - target) > MISMATCH_THRESHOLD_MINUTES) {
          result.mismatch = {
            preferred: fmtHHMM(taken.preferensi.hour, taken.preferensi.minute),
            scheduled: fmtHHMM(s.start.getHours(), s.start.getMinutes()),
            reason: 'slot terdekat penuh',
          };
        }
      }
      return result;
    });
}
