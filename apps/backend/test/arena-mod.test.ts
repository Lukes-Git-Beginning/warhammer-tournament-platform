/**
 * RizzOtto's Arena Mod version, read from the Workshop item's description. Fixtures stand in for Steam:
 * before the public release the item is unlisted and the API can't see it.
 */
import { describe, expect, it } from 'vitest';
import { parseArenaModDetails } from '../src/lib/arena-mod.js';

const listed = (description: string) => ({
  response: { result: 1, resultcount: 1, publishedfiledetails: [{ publishedfileid: '3827143159', result: 1, description, time_updated: 1793000000 }] },
});

describe('parseArenaModDetails', () => {
  it('reads the version from the plain label', () => {
    const info = parseArenaModDetails(listed('[h1]RizzOtto\'s Arena Mod[/h1]\nCurrent version: 1.0\nFor multiplayer games…'));
    expect(info).toEqual({ listed: true, version: '1.0', updatedAt: new Date(1793000000 * 1000).toISOString() });
  });

  it('reads the version when the label is wrapped in BBCode bold, with a v prefix', () => {
    expect(parseArenaModDetails(listed('[b]Current version:[/b] v1.12')).version).toBe('1.12');
  });

  it('is listed without a version when the description has no version line', () => {
    expect(parseArenaModDetails(listed('no version here'))).toMatchObject({ listed: true, version: null });
  });

  it('is unlisted while Steam answers result 9 (not found / unlisted)', () => {
    const unlisted = { response: { result: 1, resultcount: 1, publishedfiledetails: [{ publishedfileid: '3827143159', result: 9 }] } };
    expect(parseArenaModDetails(unlisted)).toEqual({ listed: false, version: null, updatedAt: null });
  });

  it('treats a malformed response as unlisted', () => {
    expect(parseArenaModDetails(null)).toEqual({ listed: false, version: null, updatedAt: null });
    expect(parseArenaModDetails({ response: {} })).toEqual({ listed: false, version: null, updatedAt: null });
  });
});
