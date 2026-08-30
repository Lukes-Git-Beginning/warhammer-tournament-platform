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
