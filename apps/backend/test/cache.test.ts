import { describe, expect, it } from 'vitest';
import { cacheKey } from '../src/lib/cache.js';

describe('cacheKey', () => {
  it('produces stable key from sorted params', () => {
    expect(cacheKey('leaderboard', { seasonId: 'x', page: 1 })).toBe(
      'leaderboard:page=1&seasonId=x',
    );
  });

  it('is order-independent', () => {
    const a = cacheKey('x', { a: 1, b: 2 });
    const b = cacheKey('x', { b: 2, a: 1 });
    expect(a).toBe(b);
  });

  it('omits undefined values', () => {
    const key = cacheKey('tournaments:list', { page: 1, pageSize: 20, seasonId: undefined });
    expect(key).toBe('tournaments:list:page=1&pageSize=20');
    expect(key).not.toContain('seasonId');
  });

  it('includes null values as "null"', () => {
    const key = cacheKey('x', { n: null });
    expect(key).toBe('x:n=null');
  });

  it('handles booleans and numbers correctly', () => {
    const key = cacheKey('x', { active: true, n: 5 });
    // sorted: active < n
    expect(key).toBe('x:active=true&n=5');
  });

  it('returns bare prefix when all params are undefined', () => {
    const key = cacheKey('foo', { a: undefined, b: undefined });
    expect(key).toBe('foo');
  });

  it('returns bare prefix when params object is empty', () => {
    expect(cacheKey('foo', {})).toBe('foo');
  });

  it('multiple params sort alphabetically', () => {
    const key = cacheKey('lb', { z: 1, a: 2, m: 3 });
    expect(key).toBe('lb:a=2&m=3&z=1');
  });
});
