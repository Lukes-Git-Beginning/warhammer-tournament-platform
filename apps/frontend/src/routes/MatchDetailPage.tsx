import { useParams, Link } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { getMatchDecision } from '@/lib/api';
import { PageShell } from '@/components/layout/PageShell';
import { Button } from '@/components/ui/button';

/**
 * Match Detail Page — stub.
 *
 * Shows a "Open Match Decision" button when the decision is not yet complete
 * (PENDING_DECISION state), otherwise shows the standard match view
 * with the picked map and factions.
 *
 * Full match data fetching (scores, participants, etc.) will be implemented
 * in Welle D.
 */
export function MatchDetailPage() {
  const { matchId } = useParams({ from: '/matches/$matchId' });

  const { data: decision, isLoading } = useQuery({
    queryKey: ['match-decision', matchId],
    queryFn: () => getMatchDecision(matchId),
    // Don't throw on 404 — match may not have a decision yet
    retry: false,
  });

  const decisionComplete = decision?.decidedAt != null;

  return (
    <PageShell variant="tight" spacing="base">
      <div className="mb-6">
        <Link
          to="/tournaments"
          search={{ tab: 'upcoming', page: 1 }}
          className="text-xs text-rizzotto-stone-500 hover:text-rizzotto-stone-300 transition-colors"
        >
          ← Back to Tournaments
        </Link>
        <h1 className="mt-3 font-display text-2xl font-bold text-rizzotto-stone-100">
          Match Details
        </h1>
        <p className="text-xs text-rizzotto-stone-500 mt-0.5 tracking-widest uppercase">
          #{matchId.slice(-8)}
        </p>
      </div>

      {/* Decision gate */}
      {!isLoading && !decisionComplete && (
        <div className="rounded-lg border border-rizzotto-gold-500/30 bg-rizzotto-gold-500/5 p-6 mb-6 flex flex-col items-center gap-4 text-center">
          <p className="text-sm text-rizzotto-stone-300">
            This match requires a map & faction decision before it can begin.
          </p>
          <Button variant="forge" size="md" asChild>
            <Link to="/matches/$matchId/decision" params={{ matchId }}>
              Open Match Decision
            </Link>
          </Button>
        </div>
      )}

      {/* Post-decision summary */}
      {decisionComplete && decision && (
        <div className="rounded-lg border border-rizzotto-iron-600 bg-rizzotto-iron-900 p-6 space-y-3">
          <h2 className="font-display text-base font-semibold text-rizzotto-gold-400">
            Match Setup
          </h2>
          <div className="text-sm text-rizzotto-stone-300 space-y-1">
            <div>
              <span className="text-rizzotto-stone-500">Map:</span>{' '}
              <span className="text-rizzotto-stone-200 font-medium">
                {decision.pickedMapId ?? '—'}
              </span>
            </div>
            {decision.blindPick?.player1FactionId && (
              <div>
                <span className="text-rizzotto-stone-500">Player 1 Faction:</span>{' '}
                <span className="text-rizzotto-stone-200">{decision.blindPick.player1FactionId}</span>
              </div>
            )}
            {decision.blindPick?.player2FactionId && (
              <div>
                <span className="text-rizzotto-stone-500">Player 2 Faction:</span>{' '}
                <span className="text-rizzotto-stone-200">{decision.blindPick.player2FactionId}</span>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Full match content — Welle D */}
      <div className="mt-6 rounded-lg border border-rizzotto-iron-700 bg-rizzotto-iron-900/60 p-6">
        <p className="text-sm text-rizzotto-stone-500 text-center">
          Full match view (scores, result reporting) — coming in Welle D.
        </p>
      </div>
    </PageShell>
  );
}
