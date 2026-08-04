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

  it('rejects non-.replay extensions even when the content is a real ESF file', () => {
    // Only the real Total War export extension (.replay) is accepted.
    expect(validateReplayUpload('game.rec', esf())).toMatch(/Total War replay files/i);
    expect(validateReplayUpload('game.wrep', esf())).toMatch(/Total War replay files/i);
  });

  it('accepts ESF signature variants seen in the wild (different game/patch)', () => {
    // Real production replays: a CA-variant signature, and a CB signature with non-zero
    // version bytes. A fixed 4-byte cbab0000 magic would wrongly reject these.
    expect(validateReplayUpload('game.replay', Buffer.from([0xca, 0xab, 0x00, 0x00]))).toBeNull();
    expect(validateReplayUpload('game.replay', Buffer.from([0xcb, 0xab, 0x20, 0x20]))).toBeNull();
  });

  it('rejects a wrong extension even if contents are a valid replay', () => {
    expect(validateReplayUpload('sneaky.jpg', esf())).toMatch(/Total War replay files/i);
  });

  it('rejects a .jpg renamed to .replay (magic-byte check)', () => {
    expect(validateReplayUpload('actually-a-photo.replay', jpeg())).toMatch(/not a Total War replay/i);
  });

  it('rejects a buffer too short to hold the signature', () => {
    expect(validateReplayUpload('game.replay', Buffer.from([0xcb]))).toMatch(/not a Total War replay/i);
  });

  it('rejects a PNG renamed to .replay (wrong signature)', () => {
    expect(validateReplayUpload('shot.replay', Buffer.from([0x89, 0x50, 0x4e, 0x47]))).toMatch(/not a Total War replay/i);
  });

  it('rejects a missing filename', () => {
    expect(validateReplayUpload(undefined, esf())).toMatch(/Total War replay files/i);
  });
});
