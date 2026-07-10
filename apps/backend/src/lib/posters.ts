import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { REPLAY_DIR } from './replays.js';

/**
 * Absolute directory where tournament poster images are stored — the single
 * source of truth shared by the upload writer (routes/tournament-poster.ts) and
 * the static server (app.ts), mirroring lib/replays.ts.
 *
 * Production runs under systemd hardening (deploy/systemd/rizzotto-backend.service:
 * `ProtectSystem=strict`, `ProtectHome=read-only`), so the ONLY writable location
 * is `ReadWritePaths=/var/lib/rizzotto/uploads`. Writing anywhere else — the repo
 * checkout OR the deploy user's home — fails with ENOENT/EROFS. Rather than
 * hard-code a path that would be wrong in dev, probe a prioritized list of
 * candidates at startup and keep the first one we can actually create. This
 * resolves to `/var/lib/rizzotto/uploads/posters` in prod and `<cwd>/uploads/posters`
 * in dev with no server provisioning required. POSTER_UPLOAD_DIR forces an
 * explicit path.
 */
function resolvePosterDir(): string {
  if (process.env.POSTER_UPLOAD_DIR) return process.env.POSTER_UPLOAD_DIR;

  const stateDir = process.env.STATE_DIRECTORY?.split(':')[0];
  const armyRoot = process.env.ARMY_LIST_UPLOAD_DIR; // deploy sets this to /var/lib/rizzotto/uploads
  const devFallback = join(process.cwd(), 'uploads', 'posters');
  const candidates = [
    stateDir && join(stateDir, 'posters'), // systemd StateDirectory, if declared
    armyRoot && join(armyRoot, 'posters'), // reuse the writable uploads root the deploy already configures
    process.platform !== 'win32' ? '/var/lib/rizzotto/uploads/posters' : null, // ReadWritePaths root (see systemd unit)
    join(dirname(REPLAY_DIR), 'posters'), // sibling of the replay upload dir
    devFallback,
  ].filter((d): d is string => Boolean(d));

  for (const dir of candidates) {
    try {
      mkdirSync(dir, { recursive: true });
      return dir;
    } catch {
      // not writable here — try the next candidate
    }
  }
  // Nothing was writable; surface a clear error from the per-request handler
  // rather than silently picking an unusable path.
  return devFallback;
}

export const POSTER_DIR = resolvePosterDir();
