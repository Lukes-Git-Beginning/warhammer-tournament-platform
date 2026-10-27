import { Link } from '@tanstack/react-router';
import type { BattleType } from '@/lib/api';
import { useArenaMod } from '@/lib/arenaMod';

/**
 * The one required mod: RizzOtto's Arena Mod, for every battle type. It brings the arena modes with
 * their maps, lobby settings, bans and (Land Battle, Conquest, Siege) the Fruit Rules, so players need
 * no other mod. Shows the current Workshop version once the item is listed. Single source of truth for
 * the notices on the tournament and Open Play pages.
 */
function ArenaModNotice({ label, className = '' }: { label: string; className?: string }) {
  const mod = useArenaMod();
  return (
    <div className={`rounded-md border border-rizzotto-gold-500/30 bg-rizzotto-gold-500/5 px-4 py-3 text-sm ${className}`}>
      <span className="text-stone-300">{label}: </span>
      <a
        href={mod.url}
        target="_blank"
        rel="noopener noreferrer"
        className="font-semibold text-rizzotto-gold-400 hover:underline"
      >
        {mod.name} ↗
      </a>
      {mod.version && <span className="text-stone-400"> · version {mod.version}</span>}
      <span className="text-stone-500"> · enable only this mod · </span>
      <Link to="/how-to-play" hash="install" className="text-rizzotto-gold-400 hover:underline">
        How to install
      </Link>
    </div>
  );
}

/** Tournament detail. The mod is the same for every battle type, so the type doesn't change the notice. */
export function RequiredModNotice({ label = 'Required mod' }: { battleType?: BattleType; label?: string }) {
  return <ArenaModNotice label={label} className="mb-8" />;
}

/** Open Play, which covers every battle type at once. */
export function RequiredModsNotice({ label = 'Required mod' }: { label?: string }) {
  return <ArenaModNotice label={label} />;
}
