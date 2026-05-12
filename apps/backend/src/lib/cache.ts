import type { Redis } from 'ioredis';

export interface CacheOptions {
  ttlSeconds: number;
}

/**
 * Try cache GET; on miss, compute and SET. JSON-serialized.
 * Returns the cached or freshly computed value.
 * If redis is undefined, falls through to compute() without any cache touch.
 */
export async function cached<T>(
  redis: Redis | undefined,
  key: string,
  compute: () => Promise<T>,
  opts: CacheOptions,
): Promise<T> {
  if (!redis) {
    return compute();
  }

  try {
    const hit = await redis.get(key);
    if (hit !== null) {
      return JSON.parse(hit) as T;
    }
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn('[cache] GET error, falling through to compute', { key, err });
    return compute();
  }

  const value = await compute();

  try {
    await redis.set(key, JSON.stringify(value), 'EX', opts.ttlSeconds);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn('[cache] SET error (non-fatal)', { key, err });
  }

  return value;
}

/**
 * Delete keys matching pattern using SCAN to avoid blocking on large keyspaces.
 * Returns the number of deleted keys.
 * If redis is undefined, returns 0.
 */
export async function invalidate(redis: Redis | undefined, pattern: string): Promise<number> {
  if (!redis) return 0;

  let cursor = '0';
  let deleted = 0;

  do {
    const [nextCursor, keys] = await redis.scan(cursor, 'MATCH', pattern, 'COUNT', 100);
    cursor = nextCursor;

    if (keys.length > 0) {
      await redis.del(...keys);
      deleted += keys.length;
    }
  } while (cursor !== '0');

  return deleted;
}

/**
 * Build a deterministic cache key from a prefix + sorted params.
 * Undefined values are omitted. Example:
 *   cacheKey('leaderboard', { seasonId: 'x', page: 1 }) → 'leaderboard:page=1&seasonId=x'
 */
export function cacheKey(
  prefix: string,
  params: Record<string, string | number | boolean | null | undefined>,
): string {
  const parts = Object.entries(params)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}=${String(v)}`);

  return parts.length > 0 ? `${prefix}:${parts.join('&')}` : prefix;
}
