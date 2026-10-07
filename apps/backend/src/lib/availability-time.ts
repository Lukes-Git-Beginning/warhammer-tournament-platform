/**
 * Availability slots are stored as LOCAL time: weekday (0=Mon..6=Sun) + hour in the owner's own
 * timezone (User.timezone, fallback site time). "Tuesday 20:00" therefore stays 20:00 local across
 * daylight-saving changes; the UTC instant is derived per concrete week, per zone.
 */
import type { Prisma, PrismaClient } from '@rizzotto/db';
import { SITE_TZ, siteParts, siteTimeToInstant } from './site-time.js';

export interface LocalSlot {
  /** 0=Mon..6=Sun, in the slot owner's local time. */
  day_of_week: number;
  /** 0..23, local wall-clock hour. */
  hour: number;
}

const validZones = new Map<string, boolean>();

/** True when `tz` is a usable IANA zone name. */
export function isValidZone(tz: string | null | undefined): tz is string {
  if (!tz) return false;
  let ok = validZones.get(tz);
  if (ok === undefined) {
    try {
      new Intl.DateTimeFormat('en-US', { timeZone: tz });
      ok = true;
    } catch {
      ok = false;
    }
    validZones.set(tz, ok);
  }
  return ok;
}

/** The zone slots of a user are interpreted in: their timezone, or site time when missing/invalid. */
export function resolveZone(tz: string | null | undefined): string {
  return isValidZone(tz) ? tz : SITE_TZ;
}

/** The (weekday, hour) a wall clock in `tz` shows at the instant `now`. */
export function localSlotNow(now: Date, tz: string | null | undefined): LocalSlot {
  const p = siteParts(now, resolveZone(tz));
  return { day_of_week: (p.weekday + 6) % 7, hour: p.hour };
}

/**
 * The UTC instant of a local slot in the (zone-local, Monday-based) week containing `weekRef`.
 * DST-correct for that concrete week: Tue 20:00 Europe/Berlin is 18:00Z in July, 19:00Z in December.
 */
export function slotToInstant(slot: LocalSlot, tz: string | null | undefined, weekRef: Date): Date {
  const zone = resolveZone(tz);
  const p = siteParts(weekRef, zone);
  const mondayDay = p.day - ((p.weekday + 6) % 7);
  return siteTimeToInstant(p.year, p.month, mondayDay + slot.day_of_week, slot.hour, 0, zone);
}

/** UTC weekday (0=Mon..6=Sun) and hour of an instant — the UTC raster the heatmap API returns. */
export function utcCellOf(instant: Date): { day_of_week: number; hour_utc: number } {
  return { day_of_week: (instant.getUTCDay() + 6) % 7, hour_utc: instant.getUTCHours() };
}

/** Project a local slot into the UTC raster cell it occupies in the week of `weekRef`. */
export function projectSlotToUtcCell(
  slot: LocalSlot,
  tz: string | null | undefined,
  weekRef: Date,
): { day_of_week: number; hour_utc: number } {
  return utcCellOf(slotToInstant(slot, tz, weekRef));
}

/**
 * A Prisma `where` matching every AvailabilitySlot that is "on" at the instant `at` — each owner
 * judged by their own wall clock. Groups by the distinct raw timezone values in use (a handful),
 * so it stays a single indexed query. Returns null when nobody has any slot.
 */
export async function slotsActiveAtWhere(
  prisma: Pick<PrismaClient, 'user'>,
  at: Date,
): Promise<Prisma.AvailabilitySlotWhereInput | null> {
  const zones = await prisma.user.groupBy({
    by: ['timezone'],
    where: { availability_slots: { some: {} } },
  });
  if (zones.length === 0) return null;
  return {
    OR: zones.map((z) => {
      const local = localSlotNow(at, z.timezone);
      return {
        day_of_week: local.day_of_week,
        hour_local: local.hour,
        user: { timezone: z.timezone },
      };
    }),
  };
}
