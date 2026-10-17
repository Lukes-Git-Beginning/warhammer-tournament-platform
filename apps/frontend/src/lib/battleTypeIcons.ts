/**
 * Battle types that have an image in public/battle-types/<type>.png. Never point an <img> at a type
 * missing here: the CDN caches the SPA fallback (index.html) under a missing asset URL for a day,
 * which would keep the icon broken after it is added. Add a type in the same deploy that ships its
 * image (Land Battle has none yet).
 */
const TYPES_WITH_ICON = new Set(['DOMINATION', 'CONQUEST', 'SIEGE']);

/** The icon path for a battle type, or null when it has no image (render a fallback instead). */
export function battleTypeIconSrc(battleType: string | null | undefined): string | null {
  return battleType && TYPES_WITH_ICON.has(battleType) ? `/battle-types/${battleType.toLowerCase()}.png` : null;
}
