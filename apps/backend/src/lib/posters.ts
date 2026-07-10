import { homedir } from 'node:os';
import { join } from 'node:path';

/**
 * Absolute directory where tournament poster images are stored.
 *
 * Must NOT live inside the repo checkout: in production the checkout
 * (/home/deploy/rizzotto) is rebuilt/replaced on deploy, and the running process
 * cannot create directories under it (that surfaced as an ENOENT on
 * mkdir '<cwd>/uploads/posters'). Default to a persistent path in the service
 * user's home instead — self-creatable without root and untouched by future
 * deploys. POSTER_UPLOAD_DIR overrides it.
 *
 * Both the upload writer (routes/tournament-poster.ts) and the static file
 * server (app.ts) MUST resolve the path from here — single source of truth,
 * mirroring lib/replays.ts.
 */
export const POSTER_DIR =
  process.env.POSTER_UPLOAD_DIR ?? join(homedir(), '.rizzotto', 'uploads', 'posters');
