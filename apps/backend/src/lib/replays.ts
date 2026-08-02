import { join } from 'node:path';

/**
 * Absolute directory where match replay files are stored.
 *
 * Production sets REPLAY_UPLOAD_DIR to a persistent path outside the repo
 * checkout (e.g. /var/lib/rizzotto/uploads/replays). Both the upload writer
 * (routes/match-games.ts) and the static file server (app.ts) MUST resolve the
 * path from here — otherwise replays get written somewhere the static server
 * cannot read, and requests fall through to the SPA fallback (which served
 * index.html instead of the file). Keep this the single source of truth.
 */
export const REPLAY_DIR =
  process.env.REPLAY_UPLOAD_DIR ?? join(process.cwd(), 'uploads', 'replays');

/**
 * A Total War replay is an ESF file — its first four bytes are the magic CB AB 00 00.
 * (A JPEG starts FF D8 FF, a PNG 89 50 4E 47, … — those must be rejected.)
 */
const REPLAY_MAGIC = Buffer.from([0xcb, 0xab, 0x00, 0x00]);

/**
 * Validate an uploaded replay: it must be named `*.replay` AND actually be an ESF file
 * (magic bytes), so a renamed .jpg/.png is caught too. Returns an error message to send to
 * the client, or `null` when the upload is a valid replay.
 */
export function validateReplayUpload(filename: string | undefined, buffer: Buffer): string | null {
  // Accept the same extensions the picker offers (.replay/.rec/.wrep). The extension is only a
  // first-line hint — the magic-byte check below is the real gate (it rejects a renamed .jpg).
  if (!filename || !/\.(replay|rec|wrep)$/i.test(filename)) {
    return 'Only Total War replay files (.replay) are accepted.';
  }
  if (buffer.length < REPLAY_MAGIC.length || !buffer.subarray(0, REPLAY_MAGIC.length).equals(REPLAY_MAGIC)) {
    return 'That file is not a Total War replay — its contents do not match the replay format.';
  }
  return null;
}
