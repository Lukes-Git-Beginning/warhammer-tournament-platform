import { useQuery } from '@tanstack/react-query';
import { useDraftSocket, sendDraftAction } from '@/hooks/useDraftSocket';
import { getFactions } from '@/lib/api';
import type { DraftView, DraftTurn } from '@rizzotto/types';
import { DraftSequenceTimeline } from './DraftSequenceTimeline';
import { DraftTimer } from './DraftTimer';
import { DraftStatusBanner } from './DraftStatusBanner';
import { FactionGrid } from './FactionGrid';
import { DraftHistory } from './DraftHistory';

interface DraftLobbyProps {
  draft: DraftView;
  viewer: 'player' | 'spectator';
}

export function DraftLobby({ draft, viewer }: DraftLobbyProps) {
  useDraftSocket({ draftId: draft.id, viewer });

  const { data: factionsData } = useQuery({
    queryKey: ['factions'],
    queryFn: () => getFactions(),
    staleTime: 5 * 60 * 1000,
  });

  const allFactions = factionsData?.data.map((entry) => entry.faction) ?? [];

  const currentTurn: DraftTurn | null = draft.preset.turns[draft.current_turn] ?? null;

  const isMyTurn: boolean =
    viewer === 'player' &&
    currentTurn !== null &&
    ((currentTurn.actor === 'host' && draft.viewer_role === 'host') ||
      (currentTurn.actor === 'guest' && draft.viewer_role === 'guest'));

  return (
    <div className="min-h-screen bg-stone-950 text-stone-100">
      {/* Top header: Draft title + sequence timeline */}
      <header className="border-b border-stone-800 bg-stone-900/50 px-4 py-3">
        <div className="mx-auto max-w-7xl">
          <div className="mb-2 flex items-center gap-3">
            <h1 className="font-display text-lg font-bold text-rizzotto-gold-500">Draft</h1>
            <span className="text-xs text-stone-500 font-mono">{draft.id.slice(0, 8)}</span>
            <span className="ml-auto text-xs text-stone-500">Preset: {draft.preset.name}</span>
          </div>
          <DraftSequenceTimeline
            turns={draft.preset.turns}
            current={draft.status === 'ONGOING' ? draft.current_turn : undefined}
          />
        </div>
      </header>

      {/* Main layout */}
      <div className="mx-auto max-w-7xl grid grid-cols-1 gap-4 p-4 lg:grid-cols-[1fr_300px]">
        {/* Left: main play area */}
        <main className="flex flex-col gap-3">
          {/* Timer */}
          {draft.status === 'ONGOING' && draft.timer_expires_at && (
            <DraftTimer expiresAt={draft.timer_expires_at} />
          )}

          {/* Status banner */}
          <DraftStatusBanner draft={draft} currentTurn={currentTurn} isMyTurn={isMyTurn} />

          {/* Final factions when completed */}
          {draft.status === 'COMPLETED' && (
            <div className="grid grid-cols-2 gap-4">
              <div className="rounded-md border border-blue-800 bg-blue-950/30 p-3">
                <h3 className="mb-2 text-xs font-bold text-blue-300 uppercase tracking-wide">
                  Host Factions
                </h3>
                <div className="flex flex-wrap gap-1 text-xs text-stone-300">
                  {draft.final_host_factions.length > 0
                    ? draft.final_host_factions.join(', ')
                    : '—'}
                </div>
              </div>
              <div className="rounded-md border border-red-800 bg-red-950/30 p-3">
                <h3 className="mb-2 text-xs font-bold text-red-300 uppercase tracking-wide">
                  Guest Factions
                </h3>
                <div className="flex flex-wrap gap-1 text-xs text-stone-300">
                  {draft.final_guest_factions.length > 0
                    ? draft.final_guest_factions.join(', ')
                    : '—'}
                </div>
              </div>
            </div>
          )}

          {/* Faction grid */}
          {allFactions.length > 0 ? (
            <FactionGrid
              allFactions={allFactions}
              state={draft.state}
              currentTurn={currentTurn}
              viewerRole={draft.viewer_role}
              onPick={(factionId) => {
                if (isMyTurn) sendDraftAction(draft.id, factionId);
              }}
            />
          ) : (
            <div className="rounded-md border border-stone-800 bg-stone-900/40 p-8 text-center text-stone-500 text-sm">
              Loading factions…
            </div>
          )}
        </main>

        {/* Right: history sidebar */}
        <aside>
          <DraftHistory draftId={draft.id} />
        </aside>
      </div>
    </div>
  );
}
