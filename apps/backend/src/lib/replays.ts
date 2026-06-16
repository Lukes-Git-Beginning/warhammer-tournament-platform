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
