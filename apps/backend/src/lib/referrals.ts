/**
 * Referral attribution helpers. PURE — unit-testable.
 *
 * `slugifyRef` turns a destination name into a stable, URL-safe ref code (the default
 * suggestion; a host can override). `isValidRef` guards what we accept from the wire.
 */

export function slugifyRef(name: string): string {
  const slug = name
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '') // strip diacritics
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
  return slug || 'ref';
}

/** A ref code is a short, URL-safe token (letters/digits/hyphen). */
export function isValidRef(ref: string): boolean {
  return /^[a-z0-9][a-z0-9-]{0,63}$/i.test(ref);
}

// ---------------------------------------------------------------------------
// Referral report merging — join announcement destinations with recorded events.
//
// The attribution reports used to be built purely from recorded ReferralHit /
// signup events, so a freshly-added destination (with no clicks yet) never
// appeared. These helpers make the destination list the *base* of the table:
// every destination shows up (counts 0 until events arrive), and any event ref
// with no matching destination is kept as an orphaned/legacy row.
// ---------------------------------------------------------------------------

/** A destination as far as reporting cares: its display name and (maybe empty) ref. */
export interface RefLabel {
  ref: string;
  name: string;
}

/** An event tally keyed by the ref that was recorded on the wire. */
export interface CountedRef {
  ref: string;
  count: number;
}

/**
 * The effective attribution ref for a destination: the explicit ref (trimmed,
 * used as-is) or, when empty, one derived from the name. Mirrors exactly the
 * rule the announcement sign-up link uses (`d.ref.trim() || slugifyRef(d.name)`),
 * so recorded hits line up with the destination that produced them.
 */
export function destinationRef(dest: RefLabel): string {
  return dest.ref.trim() || slugifyRef(dest.name);
}

export interface MergedRefRow {
  ref: string;
  /** Destination name, or null for an orphaned ref (event exists, no destination). */
  name: string | null;
  count: number;
}

/**
 * Merge a destination list with single-metric event counts keyed by ref. PURE.
 * Every destination appears (count 0 without events); event refs with no
 * destination are appended with name=null. Sorted by count desc, then label asc.
 */
export function mergeRefCounts(destinations: RefLabel[], events: CountedRef[]): MergedRefRow[] {
  const rows = new Map<string, MergedRefRow>();
  for (const d of destinations) {
    const ref = destinationRef(d);
    rows.set(ref, { ref, name: d.name, count: 0 });
  }
  for (const e of events) {
    const existing = rows.get(e.ref);
    if (existing) existing.count = e.count;
    else rows.set(e.ref, { ref: e.ref, name: null, count: e.count });
  }
  return [...rows.values()].sort(
    (a, b) => b.count - a.count || (a.name ?? a.ref).localeCompare(b.name ?? b.ref),
  );
}

export interface SourceRow {
  ref: string;
  name: string | null;
  clicks: number;
  signups: number;
  conversion: number | null;
}

/**
 * Per-tournament merge: destinations joined with click + signup counts keyed by
 * ref. PURE. Conversion is signups/clicks (null when no clicks). Sorted by
 * signups desc, then clicks desc, then label asc.
 */
export function mergeTournamentSources(
  destinations: RefLabel[],
  hits: CountedRef[],
  signups: CountedRef[],
): SourceRow[] {
  const rows = new Map<string, SourceRow>();
  const ensure = (ref: string, name: string | null): SourceRow => {
    let row = rows.get(ref);
    if (!row) {
      row = { ref, name, clicks: 0, signups: 0, conversion: null };
      rows.set(ref, row);
    } else if (row.name === null && name !== null) {
      row.name = name;
    }
    return row;
  };
  for (const d of destinations) ensure(destinationRef(d), d.name);
  for (const h of hits) ensure(h.ref, null).clicks = h.count;
  for (const s of signups) ensure(s.ref, null).signups = s.count;
  for (const row of rows.values()) row.conversion = row.clicks > 0 ? row.signups / row.clicks : null;
  return [...rows.values()].sort(
    (a, b) => b.signups - a.signups || b.clicks - a.clicks || (a.name ?? a.ref).localeCompare(b.name ?? b.ref),
  );
}

export interface OverviewRow {
  ref: string;
  name: string | null;
  clicks: number;
  signups: number;
  /** First-touch: brand-new accounts whose very first source was this ref (once per user). */
  newPlayers: number;
  conversion: number | null;
}

/**
 * Site-wide overview merge: destinations joined with clicks, tournament sign-ups
 * (summed across ALL tournaments — a user counts once per tournament joined) and
 * first-touch new-player counts (once per account), all keyed by ref. PURE.
 * Conversion is signups/clicks (null when no clicks). Sorted by sign-ups desc,
 * then clicks desc, then label asc.
 */
export function mergeOverviewSources(
  destinations: RefLabel[],
  clicks: CountedRef[],
  signups: CountedRef[],
  newPlayers: CountedRef[],
): OverviewRow[] {
  const rows = new Map<string, OverviewRow>();
  const ensure = (ref: string, name: string | null): OverviewRow => {
    let row = rows.get(ref);
    if (!row) {
      row = { ref, name, clicks: 0, signups: 0, newPlayers: 0, conversion: null };
      rows.set(ref, row);
    } else if (row.name === null && name !== null) {
      row.name = name;
    }
    return row;
  };
  for (const d of destinations) ensure(destinationRef(d), d.name);
  for (const c of clicks) ensure(c.ref, null).clicks = c.count;
  for (const s of signups) ensure(s.ref, null).signups = s.count;
  for (const n of newPlayers) ensure(n.ref, null).newPlayers = n.count;
  for (const row of rows.values()) row.conversion = row.clicks > 0 ? row.signups / row.clicks : null;
  return [...rows.values()].sort(
    (a, b) => b.signups - a.signups || b.clicks - a.clicks || (a.name ?? a.ref).localeCompare(b.name ?? b.ref),
  );
}
