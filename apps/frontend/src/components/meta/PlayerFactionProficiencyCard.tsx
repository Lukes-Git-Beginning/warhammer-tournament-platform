import { useQuery } from '@tanstack/react-query';
import {
  getPlayerFactionProficiency,
  getFactions,
} from '@/lib/api.js';
import type { PlayerFactionProficiencyDto, FactionDto } from '@rizzotto/types';
import { EmptyState } from '@/components/ui/empty-state.js';
import { FactionBadge } from './FactionBadge.js';

interface PlayerFactionProficiencyCardProps {
  userId: string;
  seasonId?: string;
}

function SkillBar({ value }: { value: number }) {
  // value is neutralWinChance — already a probability in [0..1]
  const pct = Math.round(Math.min(1, Math.max(0, value)) * 100);
  return (
    <div className="flex items-center gap-1.5">
      <div className="h-1.5 w-16 overflow-hidden rounded-full bg-stone-800">
        <div
          className="h-full rounded-full bg-rizzotto-gold-500/70"
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className="w-8 text-right text-xs text-stone-400">{pct}%</span>
    </div>
  );
}

function ProficiencyRow({
  entry,
  faction,
}: {
  entry: PlayerFactionProficiencyDto;
  faction: FactionDto | undefined;
}) {
  const winRate =
    entry.games > 0 ? Math.round((entry.wins / entry.games) * 100) : null;

  return (
    <div
      className={`flex items-center gap-2 ${entry.lowSampleWarning ? 'opacity-50' : ''}`}
    >
      {faction ? (
        <FactionBadge
          colorHex={faction.color_hex}
          initials={faction.initials}
          name={faction.name}
          iconUrl={faction.icon_url}
          size="sm"
        />
      ) : (
        <span className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-stone-800 text-[10px] text-stone-500">
          ?
        </span>
      )}

      <span className="flex min-w-0 flex-1 items-center gap-1.5 text-xs text-stone-300">
        <span className="truncate">{faction?.name ?? entry.factionId}</span>
        {entry.lowSampleWarning && (
          <span
            title="Low sample size (fewer than 5 games)"
            className="shrink-0 text-[10px] uppercase tracking-wider text-stone-500"
          >
            low sample
          </span>
        )}
      </span>

      <span className="w-10 text-right text-xs text-stone-500">{entry.games}</span>

      <span className="w-10 text-right text-xs text-stone-400">
        {winRate !== null ? `${winRate}%` : '—'}
      </span>

      <SkillBar value={entry.neutralWinChance} />
    </div>
  );
}

export function PlayerFactionProficiencyCard({
  userId,
  seasonId,
}: PlayerFactionProficiencyCardProps) {
  const { data: proficiency, isLoading: loadingProf } = useQuery({
    queryKey: ['player-faction-proficiency', userId, seasonId],
    queryFn: () => getPlayerFactionProficiency(userId, seasonId),
    retry: false,
  });

  const { data: factionsData } = useQuery({
    queryKey: ['factions'],
    queryFn: () => getFactions(),
    staleTime: 5 * 60 * 1000,
  });

  const factionMap = new Map<string, FactionDto>(
    (factionsData?.data ?? []).map((fw) => [fw.faction.id, fw.faction]),
  );

  const sorted = [...(proficiency?.entries ?? [])].sort(
    (a, b) => b.playerFactionSkill - a.playerFactionSkill,
  );

  return (
    <div className="rounded-md border border-stone-800 bg-stone-900/60 p-5">
      <p className="mb-3 text-xs uppercase tracking-wider text-stone-500">
        Faction Proficiency
      </p>

      {loadingProf ? (
        <div className="space-y-2">
          {[1, 2, 3].map((i) => (
            <div
              key={i}
              className="h-5 animate-pulse rounded bg-stone-800"
            />
          ))}
        </div>
      ) : sorted.length === 0 ? (
        <EmptyState
          variant="compact"
          title="No proficiency data yet."
          body="Play more games to unlock faction skill estimates."
        />
      ) : (
        <div className="space-y-2">
          <div className="flex items-center gap-2 pb-1 text-[10px] uppercase tracking-wider text-stone-600">
            <span className="h-6 w-6 shrink-0" aria-hidden="true" />
            <span className="min-w-0 flex-1">Faction</span>
            <span className="w-10 text-right">Games</span>
            <span className="w-10 text-right">Win rate</span>
            <span className="w-[90px]" title="Win chance vs a neutral opponent">
              Skill
            </span>
          </div>
          {sorted.map((entry) => (
            <ProficiencyRow
              key={entry.factionId}
              entry={entry}
              faction={factionMap.get(entry.factionId)}
            />
          ))}
        </div>
      )}
    </div>
  );
}
