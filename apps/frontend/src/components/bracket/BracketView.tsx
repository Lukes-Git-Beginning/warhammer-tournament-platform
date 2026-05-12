import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { TransformWrapper, TransformComponent } from 'react-zoom-pan-pinch';
import { getBracket } from '@/lib/api';
import { useLiveBracket } from '@/hooks/useLiveBracket';
import { SVGBracket } from './SVGBracket';
import { MatchScoreModal } from './MatchScoreModal';

interface BracketViewProps {
  slug: string;
  tournamentId: string;
}

export function BracketView({ slug, tournamentId }: BracketViewProps) {
  const [selectedMatchId, setSelectedMatchId] = useState<string | null>(null);

  const { data, isLoading, error } = useQuery({
    queryKey: ['bracket', slug],
    queryFn: () => getBracket(slug),
    enabled: !!slug,
  });

  useLiveBracket(tournamentId);

  if (isLoading) {
    return (
      <div className="text-stone-400 text-sm py-6">Bracket wird geladen…</div>
    );
  }

  if (error || !data) {
    return (
      <div className="rounded-md border border-red-900 bg-red-950/40 p-4 text-red-300 text-sm">
        Bracket konnte nicht geladen werden.
      </div>
    );
  }

  if (data.matches.length === 0) {
    return (
      <div className="text-stone-500 text-sm py-4">
        Noch keine Matches im Bracket.
      </div>
    );
  }

  const selectedMatch = selectedMatchId
    ? data.matches.find((m) => m.matchId === selectedMatchId) ?? null
    : null;

  return (
    <div className="relative w-full overflow-hidden rounded-md border border-stone-800 bg-stone-950">
      <TransformWrapper
        minScale={0.3}
        maxScale={2}
        initialScale={1}
        limitToBounds={false}
      >
        <TransformComponent
          wrapperStyle={{ width: '100%', height: '600px' }}
          contentStyle={{ padding: '16px' }}
        >
          <SVGBracket
            data={data}
            onMatchClick={(matchId) => setSelectedMatchId(matchId)}
          />
        </TransformComponent>
      </TransformWrapper>

      {selectedMatch && (
        <MatchScoreModal
          matchId={selectedMatch.matchId}
          player1Id={selectedMatch.player1Id}
          player2Id={selectedMatch.player2Id}
          onClose={() => setSelectedMatchId(null)}
        />
      )}
    </div>
  );
}
