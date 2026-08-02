import { describe, it, expect } from 'vitest';
import { validateReplayUpload } from '../src/lib/replays.js';

const esf = (extra: number[] = []) => Buffer.from([0xcb, 0xab, 0x00, 0x00, ...extra]);
const jpeg = () => Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);

describe('validateReplayUpload', () => {
  it('accepts a .replay file with the ESF magic', () => {
    expect(validateReplayUpload('game.replay', esf([1, 2, 3]))).toBeNull();
  });

  it('accepts a .replay file case-insensitively', () => {
    expect(validateReplayUpload('GAME.REPLAY', esf())).toBeNull();
  });

  it('accepts the other picker extensions (.rec/.wrep) when the content is a real replay', () => {
    expect(validateReplayUpload('game.rec', esf())).toBeNull();
    expect(validateReplayUpload('game.wrep', esf())).toBeNull();
  });

  it('rejects a wrong extension even if contents are a valid replay', () => {
    expect(validateReplayUpload('sneaky.jpg', esf())).toMatch(/Total War replay files/i);
  });

  it('rejects a .jpg renamed to .replay (magic-byte check)', () => {
    expect(validateReplayUpload('actually-a-photo.replay', jpeg())).toMatch(/not a Total War replay/i);
  });

  it('rejects a too-short buffer', () => {
    expect(validateReplayUpload('game.replay', Buffer.from([0xcb, 0xab]))).toMatch(/not a Total War replay/i);
  });

  it('rejects a missing filename', () => {
    expect(validateReplayUpload(undefined, esf())).toMatch(/Total War replay files/i);
  });
});
