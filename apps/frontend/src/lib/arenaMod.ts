import { useQuery } from '@tanstack/react-query';
import { getArenaMod, type ArenaModInfo } from '@/lib/api';

/** Static facts about RizzOtto's Arena Mod, used until (or if) the live Workshop data loads. */
export const ARENA_MOD_FALLBACK: ArenaModInfo = {
  workshopId: '3827143159',
  name: "RizzOtto's Arena Mod",
  url: 'https://steamcommunity.com/sharedfiles/filedetails/?id=3827143159',
  changelogUrl: 'https://steamcommunity.com/sharedfiles/filedetails/changelog/3827143159',
  listed: false,
  version: null,
  updatedAt: null,
};

/** The Total Tavern map pack and Loupi's unit caps mod that RizzOtto's Arena Mod replaces. */
export const REPLACED_MODS = [
  { id: '2875865414', name: 'Total Tavern Tournament Map Pack' },
  { id: '3763978597', name: "Loupi's Fruit Rules Unit Caps Mod" },
] as const;

export const steamWorkshopUrl = (id: string) => `https://steamcommunity.com/sharedfiles/filedetails/?id=${id}`;

/** RizzOtto's Arena Mod with its live version (the server caches Steam for 15 minutes). */
export function useArenaMod(): ArenaModInfo {
  const { data } = useQuery({ queryKey: ['arena-mod'], queryFn: getArenaMod, staleTime: 15 * 60 * 1000 });
  return data ?? ARENA_MOD_FALLBACK;
}

/** Invite to the RizzOttoverse, the Arena's Discord server (notifications, tournament talk, mod updates). */
export const RIZZOTTOVERSE_INVITE = 'https://discord.gg/MX3cs6gA54';
