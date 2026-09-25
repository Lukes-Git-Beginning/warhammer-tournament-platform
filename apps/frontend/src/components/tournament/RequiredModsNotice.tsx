import type { BattleType } from '@/lib/api';

/**
 * Required Steam Workshop mod per battle type. The mod differs by battle type and is not always
 * the same kind: Domination uses the Total Tavern map pack, Conquest uses a rules-enforcement mod
 * (unit caps), and Siege needs none. Single source of truth for the "required mod" notices on the
 * tournament and Open Play pages.
 */
type Mod = { id: string; name: string };

export const REQUIRED_MODS: Record<BattleType, Mod | null> = {
  DOMINATION: { id: '2875865414', name: 'Total Tavern Tournament Map Pack' },
  CONQUEST: { id: '3763978597', name: "Loupi's Fruit Rules Unit Caps Mod" },
  SIEGE: null,
};

const BATTLE_TYPE_LABEL: Record<BattleType, string> = {
  DOMINATION: 'Domination',
  CONQUEST: 'Conquest',
  SIEGE: 'Siege',
};

const steamUrl = (id: string) => `https://steamcommunity.com/sharedfiles/filedetails/?id=${id}`;

function ModLink({ mod }: { mod: Mod }) {
  return (
    <a
      href={steamUrl(mod.id)}
      target="_blank"
      rel="noopener noreferrer"
      className="font-semibold text-rizzotto-gold-400 hover:underline"
    >
      {mod.name} ↗
    </a>
  );
}

/**
 * Single-battle-type notice (tournament detail). Renders nothing when the battle type needs no mod
 * (Siege). Legacy tournaments with no explicit battle type are treated as Domination — the
 * historical default the single universal notice was always for.
 */
export function RequiredModNotice({
  battleType,
  label = 'Required mod',
}: {
  battleType?: BattleType;
  label?: string;
}) {
  const mod = REQUIRED_MODS[battleType ?? 'DOMINATION'];
  if (!mod) return null;
  return (
    <div className="mb-8 rounded-md border border-rizzotto-gold-500/30 bg-rizzotto-gold-500/5 px-4 py-3 text-sm">
      <span className="text-stone-300">{label}: </span>
      <ModLink mod={mod} />
    </div>
  );
}

/**
 * Multi-battle-type notice (Open Play, where a player may queue for any battle type): lists the
 * required mod per battle type, and "none" for the ones that need no mod.
 */
export function RequiredModsNotice({ label = 'Required mods' }: { label?: string }) {
  const order: BattleType[] = ['DOMINATION', 'CONQUEST', 'SIEGE'];
  return (
    <div className="rounded-md border border-rizzotto-gold-500/30 bg-rizzotto-gold-500/5 px-4 py-3 text-sm">
      <span className="text-stone-300">{label}: </span>
      {order.map((bt, i) => {
        const mod = REQUIRED_MODS[bt];
        return (
          <span key={bt}>
            {i > 0 && <span className="text-stone-600"> · </span>}
            <span className="text-stone-400">{BATTLE_TYPE_LABEL[bt]} — </span>
            {mod ? <ModLink mod={mod} /> : <span className="text-stone-500">none</span>}
          </span>
        );
      })}
    </div>
  );
}
