import { useState, useRef, useEffect } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { useNavigate } from '@tanstack/react-router';
import type { FactionDto } from '@rizzotto/types';
import { FactionBadge } from '@/components/meta/FactionBadge';
import { useReportTileVisible } from '@/contexts/ActiveMatchVisibility';

declare module '@tanstack/react-router' {
  interface HistoryState {
    freshDecision?: boolean;
  }
}
import { reportGameResult, startMatchDecision, voidDroppedMatch, assertReplayCorrect, type ReplayIssue } from '@/lib/api';
import type { GameDto, MapDto } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { LobbyCodeField } from './LobbyCodeField';

interface Props {
  matchId: string;
  game: GameDto;
  currentUserId: string;
  player1Id: string | null;
  player2Id: string | null;
  player1Name: string;
  player2Name: string;
  player1AvatarUrl?: string | null;
  player2AvatarUrl?: string | null;
  /** Faction IDs from the BracketNode (3-level fallback incl. TournamentParticipant) */
  matchPlayer1FactionId?: string | null;
  matchPlayer2FactionId?: string | null;
  /** Whether the current user is a participant in this match */
  isParticipant: boolean;
  /** Map pool for resolving picked map name */
  maps?: MapDto[];
  /** Faction id → full DTO lookup */
  factions?: Record<string, FactionDto>;
  /** Tournament mode — used to require blind pick for BPT */
  tournamentMode?: string;
  /** True for an Open Play (ladder) match — drives the 5-min (vs 2-min tournament) pick timer + copy. */
  isOpenPlay?: boolean;
  /** Set when one player in this match has withdrawn; drives the "opponent withdrew" banner. */
  withdrawnPlayerId?: string | null;
  /** True for a playoff-bracket match — a withdrawal there is a walkover (survivor advances). */
  isPlayoffMatch?: boolean;
}

export function GameTile({
  matchId,
  game,
  currentUserId,
  player1Id,
  player2Id,
  player1Name,
  player2Name,
  player1AvatarUrl,
  player2AvatarUrl,
  matchPlayer1FactionId,
  matchPlayer2FactionId,
  isParticipant,
  maps = [],
  factions = {},
  tournamentMode,
  isOpenPlay,
  withdrawnPlayerId,
  isPlayoffMatch,
}: Props) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const tileRef = useReportTileVisible(matchId);
  const [selectedWinnerId, setSelectedWinnerId] = useState<string | null>(null);
  const [replayFile, setReplayFile] = useState<File | null>(null);
  const [replayError, setReplayError] = useState<string | null>(null);
  // Replay-verification mismatch: the uploaded replay doesn't match the report → prompt the
  // reporter to upload the correct replay (A) or explain the deviation for host review (B).
  const [mismatch, setMismatch] = useState<ReplayIssue[] | null>(null);
  const [explanation, setExplanation] = useState('');
  const [mapLightbox, setMapLightbox] = useState(false);

  const pickedMap = maps.find((m) => m.id === game.decision?.pickedMapId) ?? null;

  useEffect(() => {
    if (!mapLightbox) return;
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') setMapLightbox(false); }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [mapLightbox]);

  const startDecisionMutation = useMutation({
    mutationFn: () => startMatchDecision(matchId, game.gameNumber),
    onSuccess: () => {
      void navigate({ to: '/matches/$matchId/decision', params: { matchId }, state: { freshDecision: true } });
    },
    onError: () => {
      // Decision already started by the other player — navigate there anyway
      void navigate({ to: '/matches/$matchId/decision', params: { matchId } });
    },
  });

  const reportMutation = useMutation({
    mutationFn: ({ winnerId, file, explanation: expl }: { winnerId: string; file: File | null; explanation?: string }) =>
      reportGameResult(matchId, game.gameNumber, winnerId, file ?? undefined, expl),
    onSuccess: (res) => {
      // Replay didn't match the report and no explanation given yet → show the mismatch prompt.
      if (res.mismatch) {
        setMismatch(res.issues ?? []);
        setReplayError(null);
        return;
      }
      // confirmed / held-for-review / disputed → done; refresh + reset.
      void queryClient.invalidateQueries({ queryKey: ['match-games', matchId] });
      setSelectedWinnerId(null);
      setReplayFile(null);
      setReplayError(null);
      setMismatch(null);
      setExplanation('');
    },
    onError: (err: Error) => {
      setReplayError(err.message);
    },
  });

  // Player-driven dispute: the reporter asserts the uploaded replay IS this game → the opponent is
  // asked to confirm (or, for an ambiguous replay, it goes to a host). No detached page needed.
  const assertMutation = useMutation({
    mutationFn: () => assertReplayCorrect(matchId, game.gameNumber),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['match-games', matchId] });
      setSelectedWinnerId(null);
      setReplayFile(null);
      setReplayError(null);
      setMismatch(null);
      setExplanation('');
    },
    onError: (err: Error) => setReplayError(err.message),
  });

  const voidDroppedMutation = useMutation({
    mutationFn: () => voidDroppedMatch(matchId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['match-games', matchId] });
      void queryClient.invalidateQueries({ queryKey: ['bracket'] });
    },
  });

  const isPlayer1 = currentUserId === player1Id;
  const isPlayer2 = currentUserId === player2Id;

  // Banner visibility: show when the current user is the survivor (a participant whose
  // opponent withdrew) and the game has no result yet.
  const isSurvivor =
    withdrawnPlayerId != null &&
    (isPlayer1 || isPlayer2) &&
    currentUserId !== withdrawnPlayerId;
  const gameUnresolved =
    (game.status === 'PENDING' || game.status === 'ONGOING') && !game.reportedWinnerId;
  const showWithdrawnBanner = isSurvivor && gameUnresolved;

  // Resolve faction IDs — prefer MatchGame fields, then BlindPick reveal (BPT),
  // then BracketNode (which has TournamentParticipant as final fallback).
  const p1FactionId =
    game.player1FactionId ?? game.blindPick?.player1FactionId ?? matchPlayer1FactionId ?? null;
  const p2FactionId =
    game.player2FactionId ?? game.blindPick?.player2FactionId ?? matchPlayer2FactionId ?? null;
  const p1Faction = p1FactionId ? (factions[p1FactionId] ?? null) : null;
  const p2Faction = p2FactionId ? (factions[p2FactionId] ?? null) : null;
  const myId = isPlayer1 ? player1Id : isPlayer2 ? player2Id : null;
  const opponentId = isPlayer1 ? player2Id : isPlayer2 ? player1Id : null;

  // #7: the viewer always sits on the left — swap sides when the current user is player2.
  const swap = isPlayer2 && !isPlayer1;
  const leftId = swap ? player2Id : player1Id;
  const leftName = swap ? player2Name : player1Name;
  const leftAvatarUrl = swap ? player2AvatarUrl : player1AvatarUrl;
  const leftFaction = swap ? p2Faction : p1Faction;
  const rightId = swap ? player1Id : player2Id;
  const rightName = swap ? player1Name : player2Name;
  const rightAvatarUrl = swap ? player1AvatarUrl : player2AvatarUrl;
  const rightFaction = swap ? p1Faction : p2Faction;

  // Blind pick is required for BPT tournaments and for any match that has a
  // MatchBlindPick row (Open Play matches always get one on creation).
  const needsBlindPick = tournamentMode === 'BPT' || !!game.blindPick;
  const isFreePick = tournamentMode === 'FREE_PICK';
  const decisionComplete = Boolean(
    game.decision?.pickedMapId &&
      (!needsBlindPick || game.blindPick?.revealedAt) &&
      // MATRIX + FREE_PICK need both factions resolved (not just the map) — so a
      // random/auto map can't mark the match "done" before the faction is picked.
      ((tournamentMode !== 'MATRIX' && !isFreePick) || (p1FactionId != null && p2FactionId != null)),
  );

  // #2 — Faction-pick timer. Once one player locks their blind pick, the other has this long to
  // pick (a Blind Pick Tournament gets the stricter 2 min; Open Play gets 5 min). Surface the
  // countdown on the tile so nobody is caught out.
  const blindPickTimeoutMs = isOpenPlay
    ? OPEN_PLAY_BLIND_PICK_TIMEOUT_MS
    : TOURNAMENT_BLIND_PICK_TIMEOUT_MS;
  const blindPickDeadline =
    game.blindPick?.firstLockedAt && !game.blindPick?.revealedAt
      ? new Date(new Date(game.blindPick.firstLockedAt).getTime() + blindPickTimeoutMs)
      : null;
  const blindPickTimeLeft = useCountdown(blindPickDeadline);

  const _isReporter = game.reportedWinnerId !== null && game.reporterId === currentUserId;
  const _isOpponentReporter =
    game.reportedWinnerId !== null && game.reporterId !== null && game.reporterId !== currentUserId;

  function handleWinnerSelect(winnerId: string) {
    setSelectedWinnerId(winnerId);
    setReplayError(null);
  }

  function handleSubmit() {
    if (!selectedWinnerId) return;
    if (!game.reportedWinnerId && !replayFile) {
      setReplayError('Please attach the game replay file.');
      return;
    }
    reportMutation.mutate({ winnerId: selectedWinnerId, file: replayFile });
  }

  return (
    <div ref={tileRef} className="rounded-xl border border-rizzotto-iron-600 bg-rizzotto-iron-900 p-5 flex flex-col gap-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <span className="text-xs text-rizzotto-stone-500 uppercase tracking-wider font-semibold">
          Game {game.gameNumber}
        </span>
        <StatusBadge status={game.status} />
      </div>

      {/* Opponent-withdrew banner — survivor only, unresolved game */}
      {showWithdrawnBanner && (
        <div className="rounded-lg border border-amber-700/60 bg-amber-950/40 p-4 flex flex-col gap-3">
          <div className="flex flex-col gap-1">
            <p className="text-sm font-semibold text-amber-300">⚠ Your opponent withdrew.</p>
            <p className="text-xs text-rizzotto-stone-400">
              {isPlayoffMatch
                ? 'If you played this match, report the result below. If not, take the walkover — you advance.'
                : 'If you played this match, report the result below. If not, void it.'}
            </p>
          </div>
          <Button
            variant="ghost"
            size="sm"
            className="self-start border border-rizzotto-iron-600 text-rizzotto-stone-300 hover:border-rizzotto-stone-500 hover:text-rizzotto-stone-100"
            onClick={() => voidDroppedMutation.mutate()}
            disabled={voidDroppedMutation.isPending}
          >
            {voidDroppedMutation.isPending
              ? (isPlayoffMatch ? 'Advancing…' : 'Voiding…')
              : (isPlayoffMatch ? 'Take walkover (opponent withdrew)' : 'Void match (not played)')}
          </Button>
          {voidDroppedMutation.isError && (
            <p className="text-xs text-red-400">
              {(voidDroppedMutation.error as Error).message}
            </p>
          )}
        </div>
      )}

      {/* COMPLETED */}
      {game.status === 'COMPLETED' && (
        <div className="flex items-start justify-between gap-3">
          <PlayerInfo
            name={leftName}
            avatarUrl={leftAvatarUrl}
            faction={leftFaction}
            isWinner={game.winnerId === leftId}
          />
          <div className="flex-1 flex flex-col items-center gap-2 pt-1 min-w-0">
            <div className="h-10 w-10 rounded-full border-2 border-rizzotto-gold-400 flex items-center justify-center text-rizzotto-gold-400 text-lg">
              ⚔
            </div>
            {game.winnerId ? (
              <p className="text-xs font-semibold text-rizzotto-gold-400 text-center">
                Winner:{' '}
                <span className="text-rizzotto-stone-100">
                  {game.winnerId === player1Id ? player1Name : player2Name}
                </span>
              </p>
            ) : (
              <p className="text-xs font-semibold text-rizzotto-stone-400 text-center">Draw</p>
            )}
            {pickedMap && (
              <div className="flex flex-col items-center gap-1 w-full">
                <p className="text-xs text-rizzotto-stone-500 text-center">
                  Map: <span className="text-rizzotto-stone-300">{pickedMap.name}</span>
                </p>
                {pickedMap.image_url && (
                  <button
                    type="button"
                    onClick={() => setMapLightbox(true)}
                    className="w-full mt-1 overflow-hidden rounded border border-rizzotto-iron-600 hover:border-rizzotto-gold-500 transition-colors focus:outline-none focus-visible:ring-1 focus-visible:ring-rizzotto-gold-400"
                    title="View map"
                  >
                    <img
                      src={pickedMap.image_url}
                      alt={pickedMap.name}
                      className="w-full object-contain"
                      loading="lazy"
                    />
                  </button>
                )}
              </div>
            )}
            {game.replayUrl && (
              <a
                href={game.replayUrl}
                className="text-xs text-rizzotto-gold-400 hover:underline"
                download
              >
                Download Replay
              </a>
            )}
          </div>
          <PlayerInfo
            name={rightName}
            avatarUrl={rightAvatarUrl}
            faction={rightFaction}
            isWinner={game.winnerId === rightId}
          />
        </div>
      )}

      {/* DISPUTED */}
      {game.status === 'DISPUTED' && (
        <div className="rounded-lg border border-yellow-600/50 bg-yellow-900/20 p-3 text-sm text-yellow-300">
          <p className="text-center">Result disputed — under review.</p>
          {game.verification?.issues && game.verification.issues.length > 0 && (
            <div className="mt-2 rounded border border-amber-700/50 bg-amber-950/30 p-2 text-xs text-amber-200/90">
              <p className="font-semibold text-amber-300">Replay didn&apos;t match the report:</p>
              <ul className="ml-1 mt-1 list-disc pl-4">
                {game.verification.issues.map((iss, i) => (
                  <li key={i}>{iss.message}</li>
                ))}
              </ul>
              {game.verification.explanation && (
                <p className="mt-2">
                  <span className="font-semibold text-amber-300">Reporter&apos;s explanation:</span>{' '}
                  {game.verification.explanation}
                </p>
              )}
            </div>
          )}
        </div>
      )}

      {/* PENDING / ONGOING */}
      {(game.status === 'PENDING' || game.status === 'ONGOING') && (
        <>
          {/* Players + factions — shown from the moment the tile appears when the
              factions are already known and not blind (SFT, 2D3). For 2D3 this
              surfaces the per-game roll before map selection, like an SFT faction. */}
          {!decisionComplete && !needsBlindPick && (p1Faction || p2Faction) && (
            <div className="flex items-start justify-center gap-6">
              <PlayerInfo name={leftName} avatarUrl={leftAvatarUrl} faction={leftFaction} />
              <span className="self-center text-xs uppercase tracking-wider text-rizzotto-stone-500">vs</span>
              <PlayerInfo name={rightName} avatarUrl={rightAvatarUrl} faction={rightFaction} />
            </div>
          )}

          {/* Decision phase */}
          {!decisionComplete && (
            <div className="flex flex-col gap-3">
              {!game.decision ? (
                isParticipant ? (
                  <div className="flex flex-col items-center gap-3">
                    <p className="text-sm text-rizzotto-stone-400 text-center">
                      {isFreePick ? 'Faction and map selection not started yet.' : 'Map and faction selection not started yet.'}
                    </p>
                    <Button
                      variant="forge"
                      size="sm"
                      onClick={() => startDecisionMutation.mutate()}
                      disabled={startDecisionMutation.isPending}
                    >
                      {startDecisionMutation.isPending
                        ? 'Rolling…'
                        : isFreePick
                          ? 'Choose Faction & Battlefield'
                          : needsBlindPick
                            ? 'Choose Map & Faction'
                            : 'Choose Battlefield'}
                    </Button>
                  </div>
                ) : (
                  <p className="text-sm text-rizzotto-stone-500 text-center">
                    Waiting for players to start map selection.
                  </p>
                )
              ) : (
                <div className="flex flex-col items-center gap-3">
                  {/* Map is already decided — show it even before faction pick */}
                  {game.decision.pickedMapId && pickedMap ? (
                    <div className="flex flex-col items-center gap-1 w-full">
                      <span className="text-xs text-rizzotto-stone-500 uppercase tracking-wider">Battlefield</span>
                      <p className="text-sm font-semibold text-rizzotto-stone-100 text-center leading-tight">
                        {pickedMap.name}
                      </p>
                      {pickedMap.image_url && (
                        <button
                          type="button"
                          onClick={() => setMapLightbox(true)}
                          className="w-full mt-1 overflow-hidden rounded border border-rizzotto-iron-600 hover:border-rizzotto-gold-500 transition-colors focus:outline-none focus-visible:ring-1 focus-visible:ring-rizzotto-gold-400"
                          title="View map"
                        >
                          <img
                            src={pickedMap.image_url}
                            alt={pickedMap.name}
                            className="w-full object-contain"
                            loading="lazy"
                          />
                        </button>
                      )}
                    </div>
                  ) : (
                    <p className="text-sm text-rizzotto-stone-400 text-center">
                      {game.decision.mode === 'RANDOM' ? 'Drawing battlefield…' : 'Picking battlefield…'}
                    </p>
                  )}
                  {blindPickTimeLeft && (
                    <p className="text-xs font-semibold text-rizzotto-gold-400 text-center">
                      ⏱ {blindPickTimeLeft}{' '}
                      {isOpenPlay
                        ? 'to pick — or the match is cancelled'
                        : 'until a faction is auto-picked'}
                    </p>
                  )}
                  <Button variant="forge" size="sm" asChild>
                    <Link to="/matches/$matchId/decision" params={{ matchId }}>
                      {isFreePick
                        ? 'Continue Setup'
                        : game.decision?.pickedMapId && tournamentMode === 'MATRIX'
                          ? 'Continue Faction Picking'
                          : game.decision?.pickedMapId && needsBlindPick
                            ? 'Pick Your Faction'
                            : 'Go to Map Selection'}
                    </Link>
                  </Button>
                </div>
              )}
            </div>
          )}

          {/* Decision complete — show map + lobby code + result reporting */}
          {decisionComplete && (
            <div className="flex flex-col gap-4">
              {/* Player info + Map (3-column layout) */}
              <div className="flex items-start justify-between gap-3">
                <PlayerInfo name={leftName} avatarUrl={leftAvatarUrl} faction={leftFaction} />
                {pickedMap ? (
                  <div className="flex-1 flex flex-col items-center gap-1 min-w-0">
                    <span className="text-xs text-rizzotto-stone-500 uppercase tracking-wider">Battlefield</span>
                    <p className="text-sm font-semibold text-rizzotto-stone-100 text-center leading-tight">
                      {pickedMap.name}
                    </p>
                    {pickedMap.image_url && (
                      <button
                        type="button"
                        onClick={() => setMapLightbox(true)}
                        className="w-full mt-1 overflow-hidden rounded border border-rizzotto-iron-600 hover:border-rizzotto-gold-500 transition-colors focus:outline-none focus-visible:ring-1 focus-visible:ring-rizzotto-gold-400"
                        title="View map"
                      >
                        <img
                          src={pickedMap.image_url}
                          alt={pickedMap.name}
                          className="w-full object-contain"
                          loading="lazy"
                        />
                      </button>
                    )}
                  </div>
                ) : (
                  <div className="flex-1" />
                )}
                <PlayerInfo name={rightName} avatarUrl={rightAvatarUrl} faction={rightFaction} />
              </div>

              {/* Lobby code + password */}
              <LobbyCodeField
                matchId={matchId}
                gameNumber={game.gameNumber}
                currentCode={game.lobbyCode}
                currentPassword={game.lobbyPassword}
                canEdit={isParticipant}
              />

              {/* Result reporting — only for participants. Keep it open while the mismatch
                  prompt is showing (paths A/B/C): the report sets reported_winner_id, so the
                  5s Open-Play refetch would otherwise pull the block out from under the prompt. */}
              {isParticipant && (!game.reportedWinnerId || mismatch) && (
                <div className="flex flex-col gap-3 pt-2 border-t border-rizzotto-iron-700">
                  <span className="text-xs text-rizzotto-stone-500 uppercase tracking-wider">Report Result</span>
                  <div className="flex gap-2">
                    <button
                      onClick={() => handleWinnerSelect(myId!)}
                      className={`flex-1 py-2 px-3 rounded-lg border text-sm font-semibold transition-colors ${
                        selectedWinnerId === myId
                          ? 'border-rizzotto-gold-400 bg-rizzotto-gold-400/10 text-rizzotto-gold-300'
                          : 'border-rizzotto-iron-600 text-rizzotto-stone-300 hover:border-rizzotto-stone-500 hover:bg-rizzotto-iron-800 hover:text-rizzotto-stone-100'
                      }`}
                    >
                      I Won
                    </button>
                    <button
                      onClick={() => handleWinnerSelect(opponentId!)}
                      className={`flex-1 py-2 px-3 rounded-lg border text-sm font-semibold transition-colors ${
                        selectedWinnerId === opponentId
                          ? 'border-rizzotto-gold-400 bg-rizzotto-gold-400/10 text-rizzotto-gold-300'
                          : 'border-rizzotto-iron-600 text-rizzotto-stone-300 hover:border-rizzotto-stone-500 hover:bg-rizzotto-iron-800 hover:text-rizzotto-stone-100'
                      }`}
                    >
                      Opponent Won
                    </button>
                  </div>

                  {selectedWinnerId && (
                    <div className="flex flex-col gap-2">
                      <div className="flex items-center gap-2">
                        <input
                          ref={fileInputRef}
                          type="file"
                          accept=".replay"
                          className="hidden"
                          onChange={(e) => {
                            setReplayFile(e.target.files?.[0] ?? null);
                            setReplayError(null);
                          }}
                        />
                        <button
                          onClick={() => fileInputRef.current?.click()}
                          className="text-xs text-rizzotto-stone-400 hover:text-rizzotto-gold-400 transition-colors border border-rizzotto-iron-600 rounded px-2 py-1"
                        >
                          {replayFile ? `✓ ${replayFile.name}` : 'Attach Replay (required)'}
                        </button>
                      </div>
                      {replayError && (
                        <p className="text-xs text-red-400">{replayError}</p>
                      )}
                      {!mismatch && (
                        <Button
                          variant="forge"
                          size="sm"
                          onClick={handleSubmit}
                          disabled={reportMutation.isPending}
                        >
                          {reportMutation.isPending ? 'Submitting…' : 'Submit Result'}
                        </Button>
                      )}

                      {/* Replay-verification mismatch prompt (paths A / B). */}
                      {mismatch && (
                        <div className="flex flex-col gap-2 rounded-lg border border-amber-700/60 bg-amber-950/20 p-3">
                          <p className="text-xs font-semibold text-amber-300">
                            ⚠️ This replay doesn&apos;t look like this game:
                          </p>
                          <ul className="ml-1 list-disc pl-4 text-xs text-amber-200/90">
                            {mismatch.map((iss, i) => (
                              <li key={i}>{iss.message}</li>
                            ))}
                          </ul>
                          {/* Path A — upload the correct replay and re-submit. */}
                          <p className="mt-1 text-xs text-rizzotto-stone-300">
                            Attached the wrong file? Choose the correct replay above, then:
                          </p>
                          <Button
                            variant="forge"
                            size="sm"
                            onClick={() => reportMutation.mutate({ winnerId: selectedWinnerId!, file: replayFile })}
                            disabled={reportMutation.isPending}
                          >
                            {reportMutation.isPending ? 'Checking…' : 'Re-check corrected replay'}
                          </Button>
                          {/* Path B — the replay IS this game (report used a wrong faction/map): the opponent
                              confirms and the replay's factions/map are applied. No host needed. */}
                          <p className="mt-1 text-xs text-rizzotto-stone-300">
                            The replay <em>is</em> this game (your report just had the wrong faction/map)? Ask your
                            opponent to confirm it — the replay&apos;s factions and map are applied, no host review needed.
                          </p>
                          <Button
                            variant="forge"
                            size="sm"
                            onClick={() => assertMutation.mutate()}
                            disabled={assertMutation.isPending}
                          >
                            {assertMutation.isPending ? 'Sending…' : 'The replay is correct — ask opponent to confirm'}
                          </Button>
                          {/* Path C — a genuine deviation the replay can't settle: explain it for host review. */}
                          <p className="mt-1 text-xs text-rizzotto-stone-300">
                            Something else off (e.g. you agreed to play a different matchup)? Explain it —
                            the match is only scored once a host/admin has reviewed it, and your opponent is notified.
                          </p>
                          <textarea
                            value={explanation}
                            onChange={(e) => setExplanation(e.target.value)}
                            rows={2}
                            maxLength={2000}
                            placeholder="Report is correct because…"
                            className="w-full rounded border border-rizzotto-iron-600 bg-rizzotto-iron-900 px-2 py-1 text-xs text-rizzotto-stone-100 placeholder:text-rizzotto-stone-500 focus:border-rizzotto-gold-500/60 focus:outline-none"
                          />
                          <Button
                            variant="iron"
                            size="sm"
                            onClick={() => reportMutation.mutate({ winnerId: selectedWinnerId!, file: replayFile, explanation: explanation.trim() })}
                            disabled={reportMutation.isPending || explanation.trim().length === 0}
                          >
                            Submit for review with explanation
                          </Button>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}

              {/* Provisional — reporter sees countdown */}
              {game.reportedWinnerId && !game.confirmedAt && isParticipant && (
                <ProvisionalPanel
                  matchId={matchId}
                  game={game}
                  currentUserId={currentUserId}
                  player1Id={player1Id}
                  player2Id={player2Id}
                  player1Name={player1Name}
                  player2Name={player2Name}
                  onRespond={(winnerId, file) => reportMutation.mutate({ winnerId, file })}
                  isPending={reportMutation.isPending}
                />
              )}
            </div>
          )}
        </>
      )}

      {/* Map lightbox */}
      {mapLightbox && pickedMap?.image_url && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4"
          onClick={() => setMapLightbox(false)}
        >
          <div className="relative flex flex-col items-center gap-2 w-full h-full">
            <div className="flex items-center justify-between w-full px-1 shrink-0">
              <span className="text-white font-semibold">{pickedMap.name}</span>
              <button
                type="button"
                onClick={() => setMapLightbox(false)}
                className="text-white/60 hover:text-white text-xl leading-none transition-colors"
                aria-label="Close"
              >
                ✕
              </button>
            </div>
            <img
              src={pickedMap.image_url}
              alt={pickedMap.name}
              className="w-full h-full object-contain"
            />
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function PlayerInfo({
  name,
  avatarUrl,
  faction,
  isWinner,
}: {
  name: string;
  avatarUrl?: string | null;
  faction?: FactionDto | null;
  isWinner?: boolean;
}) {
  return (
    <div className="flex flex-col items-center gap-2 w-28 shrink-0">
      {avatarUrl ? (
        <img
          src={avatarUrl}
          alt=""
          className="rounded-full object-cover border border-rizzotto-iron-600"
          style={{ width: 60, height: 60 }}
        />
      ) : (
        <span
          className="rounded-full flex items-center justify-center bg-rizzotto-iron-700 text-rizzotto-stone-300 text-xl font-semibold select-none"
          style={{ width: 60, height: 60 }}
        >
          {name.slice(0, 1).toUpperCase()}
        </span>
      )}
      <span
        className={`text-xs text-center w-full leading-tight ${
          isWinner ? 'text-rizzotto-gold-400 font-semibold' : 'text-rizzotto-stone-300'
        }`}
        style={{ overflowWrap: 'break-word' }}
      >
        {name}
      </span>
      {faction && (
        <>
          <FactionBadge
            size="lg"
            colorHex={faction.color_hex}
            initials={faction.initials}
            name={faction.name}
            iconUrl={faction.icon_url}
          />
          <span
            className={`text-xs text-center w-full leading-tight ${
              isWinner ? 'text-rizzotto-gold-400' : 'text-rizzotto-stone-300'
            }`}
            style={{ overflowWrap: 'break-word' }}
          >
            {faction.name}
          </span>
        </>
      )}
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const colors: Record<string, string> = {
    PENDING: 'text-rizzotto-stone-500 border-rizzotto-iron-600',
    ONGOING: 'text-blue-400 border-blue-800',
    COMPLETED: 'text-rizzotto-gold-400 border-rizzotto-gold-800',
    DISPUTED: 'text-yellow-400 border-yellow-800',
  };
  return (
    <span className={`text-xs border rounded px-1.5 py-0.5 ${colors[status] ?? colors['PENDING']}`}>
      {status}
    </span>
  );
}

function ProvisionalPanel({
  matchId: _matchId,
  game,
  currentUserId,
  player1Id,
  player2Id,
  player1Name,
  player2Name,
  onRespond,
  isPending,
}: {
  matchId: string;
  game: GameDto;
  currentUserId: string;
  player1Id: string | null;
  player2Id: string | null;
  player1Name: string;
  player2Name: string;
  onRespond: (winnerId: string, file: File | null) => void;
  isPending: boolean;
}) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [confirmFile, setConfirmFile] = useState<File | null>(null);
  const autoConfirmsAt = game.reportedAt
    ? new Date(new Date(game.reportedAt).getTime() + 30 * 60 * 1000)
    : null;
  const timeLeft = useCountdown(autoConfirmsAt);

  const reportedWinnerName =
    game.reportedWinnerId === player1Id ? player1Name : player2Name;
  const isReporter = game.reporterId === currentUserId;
  const isOpponent = !isReporter;

  return (
    <div className="flex flex-col gap-3 pt-2 border-t border-rizzotto-iron-700">
      <div className="rounded-lg border border-rizzotto-iron-600 bg-rizzotto-iron-800/60 p-3 text-sm">
        <p className="text-rizzotto-stone-300">
          <span className="font-semibold text-rizzotto-gold-400">{reportedWinnerName}</span> reported
          as winner.
        </p>
        {timeLeft && (
          <p className="text-xs text-rizzotto-stone-500 mt-1">
            Auto-confirms in <span className="font-mono">{timeLeft}</span>
          </p>
        )}
      </div>

      {isOpponent && (
        <div className="flex flex-col gap-2">
          <p className="text-xs text-rizzotto-stone-500">Confirm or dispute:</p>
          <div className="flex gap-2">
            <Button
              variant="forge"
              size="sm"
              onClick={() => onRespond(game.reportedWinnerId!, confirmFile)}
              disabled={isPending}
            >
              Confirm
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                const otherId =
                  game.reportedWinnerId === player1Id ? player2Id : player1Id;
                if (otherId) onRespond(otherId, confirmFile);
              }}
              disabled={isPending}
            >
              Dispute
            </Button>
          </div>
          <div className="flex items-center gap-2">
            <input
              ref={fileInputRef}
              type="file"
              accept=".replay"
              className="hidden"
              onChange={(e) => setConfirmFile(e.target.files?.[0] ?? null)}
            />
            <button
              onClick={() => fileInputRef.current?.click()}
              className="text-xs text-rizzotto-stone-500 hover:text-rizzotto-gold-400 transition-colors"
            >
              {confirmFile ? `✓ ${confirmFile.name}` : 'Attach replay (optional)'}
            </button>
          </div>
        </div>
      )}

      {isReporter && (
        <p className="text-xs text-rizzotto-stone-500 italic">
          Waiting for your opponent to confirm or dispute.
        </p>
      )}
    </div>
  );
}

// Mirror of the timeouts in apps/backend/src/lib/blind-pick-auto-resolve.ts — once one player
// locks, the other has this long to pick. Open Play (ladder) gets 5 minutes and the match is then
// cancelled (the no-show gets a queue cooldown); a Blind Pick Tournament gets the stricter 2 minutes
// and a random faction is assigned instead.
const OPEN_PLAY_BLIND_PICK_TIMEOUT_MS = 5 * 60 * 1000;
const TOURNAMENT_BLIND_PICK_TIMEOUT_MS = 2 * 60 * 1000;

function useCountdown(target: Date | null): string | null {
  const [remaining, setRemaining] = useState<string | null>(null);

  useEffect(() => {
    if (!target) return;
    function update() {
      const diff = target!.getTime() - Date.now();
      if (diff <= 0) { setRemaining(null); return; }
      const m = Math.floor(diff / 60000);
      const s = Math.floor((diff % 60000) / 1000);
      setRemaining(`${m}:${s.toString().padStart(2, '0')}`);
    }
    update();
    const id = setInterval(update, 1000);
    return () => clearInterval(id);
  }, [target]);

  return remaining;
}
