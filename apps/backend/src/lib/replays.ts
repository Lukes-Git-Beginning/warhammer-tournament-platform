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
 * A Total War replay is an ESF file. Its 2-byte signature is a variant marker (0xCA–0xCF,
 * which differs by game/patch) followed by 0xAB — e.g. `CB AB` (the common TWW3 export) or
 * `CA AB`. The two bytes AFTER the signature are a version/flags field and DO vary in the
 * wild (`00 00`, `20 20`, …), so only the 2-byte SIGNATURE is checked — a fixed 4-byte magic
 * would wrongly reject valid replays from other patches. (A JPEG starts `FF D8`, a PNG
 * `89 50` — neither has 0xAB as its second byte, so both are still rejected.)
 */
function hasEsfSignature(buffer: Buffer): boolean {
  return buffer.length >= 2 && buffer[1] === 0xab && buffer[0]! >= 0xca && buffer[0]! <= 0xcf;
}

/**
 * Validate an uploaded replay: it must be named `*.replay` AND actually carry the ESF
 * signature, so a renamed .jpg/.png is caught too. Returns an error message to send to the
 * client, or `null` when the upload is a valid replay.
 */
export function validateReplayUpload(filename: string | undefined, buffer: Buffer): string | null {
  // Total War: Warhammer exports replays as `.replay` — the only extension we accept. (The
  // extension is a first-line hint; the ESF signature check below is the real gate.)
  if (!filename || !/\.replay$/i.test(filename)) {
    return 'Only Total War replay files (.replay) are accepted.';
  }
  if (!hasEsfSignature(buffer)) {
    return 'That file is not a Total War replay — its contents do not match the replay format.';
  }
  return null;
}
