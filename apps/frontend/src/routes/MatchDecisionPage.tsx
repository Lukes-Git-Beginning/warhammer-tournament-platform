import { useState, useEffect, useRef } from 'react';
import { useParams, useRouter, useRouterState } from '@tanstack/react-router';
import { motion, AnimatePresence } from 'motion/react';
import { useQuery, useQueryClient, useMutation } from '@tanstack/react-query';
import { useAuthQuery } from '@/lib/auth';
import {
  getMatchDecision,
  forceResolveDecision,
  banMap,
  lockBlindPick,
  getFactions,
} from '@/lib/api';
import type { MatchDecisionState, MapDto } from '@/lib/api';
import { getSocket } from '@/lib/socket';
import { PageShell } from '@/components/layout/PageShell';
import { Button } from '@/components/ui/button';
import { FactionBadge } from '@/components/meta/FactionBadge';
import type { ServerToClientEvents, FactionWithStatsDto } from '@rizzotto/types';

// ---------------------------------------------------------------------------
// Coin Flip Phase
// ---------------------------------------------------------------------------

interface CoinFlipPhaseProps {
  decision: MatchDecisionState;
  currentUserId: string;
  topPlayerAvatar?: string | null;
  bottomPlayerAvatar?: string | null;
  topPlayerName?: string;
  bottomPlayerName?: string;
  /** Skip the spin animation — coin shows result immediately (returning to an existing decision). */
  skipAnimation?: boolean;
}

function CoinFace({
  avatarUrl,
  name,
  winner,
}: {
  avatarUrl?: string | null;
  name?: string;
  winner: boolean;
}) {
  const initials = (name ?? '?').slice(0, 2).toUpperCase();
  return (
    <div
      className={`absolute inset-0 rounded-full overflow-hidden flex items-center justify-center
        ${winner ? 'border-2 border-rizzotto-gold-500 shadow-[0_0_16px_2px_rgba(212,175,55,0.35)]' : 'border-2 border-rizzotto-iron-500'}`}
    >
      {avatarUrl ? (
        <img src={avatarUrl} alt={name ?? ''} className="h-full w-full object-cover" draggable={false} />
      ) : (
        <span className="font-display text-3xl font-bold text-rizzotto-gold-400 bg-rizzotto-iron-800 h-full w-full flex items-center justify-center">
          {initials}
        </span>
      )}
      {/* subtle vignette */}
      <div className="absolute inset-0 rounded-full bg-gradient-to-b from-transparent to-rizzotto-iron-950/40 pointer-events-none" />
    </div>
  );
}

function CoinFlipPhase({
  decision,
  currentUserId,
  topPlayerAvatar,
  bottomPlayerAvatar,
  topPlayerName,
  bottomPlayerName,
  skipAnimation = false,
}: CoinFlipPhaseProps) {
  // If we're returning to an existing decision, start revealed immediately.
  const [revealed, setRevealed] = useState(skipAnimation);
  const isTop = decision.topPlayerId === currentUserId;
  const isBottom = decision.bottomPlayerId === currentUserId;

  useEffect(() => {
    if (skipAnimation) return;
    const timer = setTimeout(() => setRevealed(true), 2200);
    return () => clearTimeout(timer);
  }, [skipAnimation]);

  return (
    <div className="flex flex-col items-center gap-8">
      <h2 className="font-display text-xl font-semibold text-rizzotto-gold-400 tracking-wider">
        Coin Flip
      </h2>

      {/* 3D coin — front = topPlayer (winner), back = bottomPlayer */}
      <div style={{ perspective: 800 }} className="h-28 w-28">
        <motion.div
          animate={{ rotateY: skipAnimation ? 0 : [0, 360, 720, 1080, 1440] }}
          transition={skipAnimation ? { duration: 0 } : { duration: 2, ease: 'easeOut', times: [0, 0.25, 0.5, 0.75, 1] }}
          className="relative h-28 w-28"
          style={{ transformStyle: 'preserve-3d' }}
        >
          {/* Front face — topPlayer (winner, lands face-up) */}
          <div style={{ backfaceVisibility: 'hidden' }} className="absolute inset-0">
            <CoinFace
              avatarUrl={topPlayerAvatar}
              name={topPlayerName}
              winner={true}
            />
          </div>

          {/* Back face — bottomPlayer */}
          <div
            style={{ backfaceVisibility: 'hidden', transform: 'rotateY(180deg)' }}
            className="absolute inset-0"
          >
            <CoinFace
              avatarUrl={bottomPlayerAvatar}
              name={bottomPlayerName}
              winner={false}
            />
          </div>
        </motion.div>
      </div>

      <AnimatePresence>
        {revealed && (
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
            className="w-full max-w-sm space-y-3"
          >
            {/* Top player (winner) */}
            <div
              className={`flex items-center gap-3 rounded-md border px-4 py-3 transition-colors ${
                decision.topPlayerId === currentUserId
                  ? 'border-rizzotto-gold-500/60 bg-rizzotto-gold-500/10'
                  : 'border-rizzotto-iron-600 bg-rizzotto-iron-900'
              }`}
            >
              {topPlayerAvatar ? (
                <img src={topPlayerAvatar} alt="" className="h-7 w-7 rounded-full object-cover shrink-0" />
              ) : (
                <span className="h-7 w-7 rounded-full bg-rizzotto-iron-700 flex items-center justify-center text-xs font-bold text-rizzotto-stone-300 shrink-0">
                  {(topPlayerName ?? '?').slice(0, 2).toUpperCase()}
                </span>
              )}
              <span className="flex-1 text-sm text-rizzotto-stone-300">
                {isTop ? 'You' : (topPlayerName ?? 'Opponent')}
              </span>
              <span className="font-display text-xs font-semibold tracking-widest text-rizzotto-gold-400 uppercase">
                ⚔ Top
              </span>
            </div>

            {/* Bottom player */}
            <div
              className={`flex items-center gap-3 rounded-md border px-4 py-3 transition-colors ${
                decision.bottomPlayerId === currentUserId
                  ? 'border-rizzotto-gold-500/60 bg-rizzotto-gold-500/10'
                  : 'border-rizzotto-iron-600 bg-rizzotto-iron-900'
              }`}
            >
              {bottomPlayerAvatar ? (
                <img src={bottomPlayerAvatar} alt="" className="h-7 w-7 rounded-full object-cover shrink-0" />
              ) : (
                <span className="h-7 w-7 rounded-full bg-rizzotto-iron-700 flex items-center justify-center text-xs font-bold text-rizzotto-stone-300 shrink-0">
                  {(bottomPlayerName ?? '?').slice(0, 2).toUpperCase()}
                </span>
              )}
              <span className="flex-1 text-sm text-rizzotto-stone-300">
                {isBottom ? 'You' : (bottomPlayerName ?? 'Opponent')}
              </span>
              <span className="font-display text-xs font-semibold tracking-widest text-rizzotto-stone-400 uppercase">
                Bottom
              </span>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Map Decision — RANDOM
// ---------------------------------------------------------------------------

interface RandomMapPhaseProps {
  pickedMapId: string | null;
  mapPool: MapDto[];
}

function RandomMapPhase({ pickedMapId, mapPool }: RandomMapPhaseProps) {
  const [spinning, setSpinning] = useState(true);
  const [displayedIndex, setDisplayedIndex] = useState(0);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const pickedMap = mapPool.find((m) => m.id === pickedMapId);

  useEffect(() => {
    if (!mapPool.length) return;

    // Spin through maps quickly, then settle
    let speed = 80;
    let elapsed = 0;
    const total = 2200;

    function tick() {
      elapsed += speed;
      setDisplayedIndex((i) => (i + 1) % mapPool.length);
      if (elapsed >= total) {
        if (intervalRef.current) clearInterval(intervalRef.current);
        setSpinning(false);
      } else if (elapsed > total * 0.6) {
        speed = 200; // slow down
      }
    }

    intervalRef.current = setInterval(tick, speed);
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [mapPool]);

  const displayedMap = spinning ? mapPool[displayedIndex] : (pickedMap ?? mapPool[displayedIndex]);

  return (
    <div className="flex flex-col items-center gap-6">
      <h2 className="font-display text-xl font-semibold text-rizzotto-gold-400 tracking-wider">
        Map Selection — Random Draw
      </h2>

      <div className="relative overflow-hidden rounded-lg border border-rizzotto-iron-600 bg-rizzotto-iron-900 w-72 h-44 flex flex-col items-center justify-center shadow-rizzotto-banner">
        {displayedMap?.image_url && (
          <img
            src={displayedMap.image_url}
            alt=""
            className={`absolute inset-0 w-full h-full object-cover transition-opacity duration-100 ${spinning ? 'opacity-30' : 'opacity-50'}`}
          />
        )}
        <div className="relative z-10 text-center px-4">
          <p
            className={`font-display font-bold leading-tight transition-all ${
              spinning
                ? 'text-lg text-rizzotto-stone-300'
                : 'text-2xl text-rizzotto-gold-400'
            }`}
          >
            {displayedMap?.name ?? '…'}
          </p>
          {!spinning && (
            <motion.p
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="mt-1 text-xs text-rizzotto-stone-400 tracking-widest uppercase"
            >
              Map Chosen
            </motion.p>
          )}
        </div>
        {spinning && (
          <div className="absolute inset-0 bg-rizzotto-iron-950/60 flex items-center justify-center">
            <span className="block h-8 w-8 rounded-full border-2 border-rizzotto-gold-400 border-t-transparent animate-spin" />
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Map Decision — PICK_BAN
// ---------------------------------------------------------------------------

interface PickBanPhaseProps {
  decision: MatchDecisionState;
  mapPool: MapDto[];
  currentUserId: string;
  matchId: string;
  onDecisionUpdate: (d: MatchDecisionState) => void;
}

function PickBanPhase({
  decision,
  mapPool,
  currentUserId,
  matchId,
  onDecisionUpdate,
}: PickBanPhaseProps) {
  const [banning, setBanning] = useState(false);

  const isTop = decision.topPlayerId === currentUserId;
  const isBottom = decision.bottomPlayerId === currentUserId;

  // Whose turn is it?
  const topBanCount = decision.bansTop.length;
  const bottomBanCount = decision.bansBottom.length;
  const isTopTurn = topBanCount === 0;
  const isBottomTurn = topBanCount === 1 && bottomBanCount === 0;
  const isMyTurn = (isTop && isTopTurn) || (isBottom && isBottomTurn);

  const allBannedIds = [...decision.bansTop, ...decision.bansBottom];

  async function handleBan(mapId: string) {
    setBanning(true);
    try {
      const updated = await banMap(matchId, mapId);
      onDecisionUpdate(updated);
    } catch {
      // ignore — socket will sync
    } finally {
      setBanning(false);
    }
  }

  const phase =
    decision.pickedMapId != null
      ? 'complete'
      : !isMyTurn
        ? 'waiting'
        : 'banning';

  const pickedMap = mapPool.find((m) => m.id === decision.pickedMapId);

  return (
    <div className="flex flex-col items-center gap-6">
      <h2 className="font-display text-xl font-semibold text-rizzotto-gold-400 tracking-wider">
        Map Pick &amp; Ban
      </h2>

      {/* Status banner */}
      <div className="text-sm text-rizzotto-stone-400 text-center">
        {phase === 'complete' && (
          <span className="text-rizzotto-gold-400 font-semibold">Map chosen!</span>
        )}
        {phase === 'waiting' && (
          <span className="flex items-center gap-2">
            <span className="h-2 w-2 rounded-full bg-rizzotto-stone-500 animate-pulse" />
            Waiting for opponent to ban a map…
          </span>
        )}
        {phase === 'banning' && (
          <span className="text-rizzotto-stone-200">
            Your turn — ban one map from the pool.
          </span>
        )}
      </div>

      {/* Map grid */}
      <div className="grid grid-cols-3 gap-3 w-full max-w-lg">
        {mapPool.map((map) => {
          const isBanned = allBannedIds.includes(map.id);
          const isPicked = map.id === decision.pickedMapId;
          const isClickable = phase === 'banning' && !isBanned && !banning;

          return (
            <motion.button
              key={map.id}
              type="button"
              disabled={!isClickable}
              onClick={() => isClickable && handleBan(map.id)}
              whileHover={isClickable ? { scale: 1.03, y: -2 } : {}}
              whileTap={isClickable ? { scale: 0.97 } : {}}
              className={[
                'relative overflow-hidden rounded-md border aspect-[4/3] flex flex-col items-center justify-center text-center transition-all',
                isBanned
                  ? 'border-rizzotto-blood-500/40 bg-rizzotto-iron-900/60 grayscale'
                  : isPicked
                    ? 'border-rizzotto-gold-400 bg-rizzotto-gold-500/10 shadow-rizzotto-emboss'
                    : isClickable
                      ? 'border-rizzotto-iron-600 bg-rizzotto-iron-900 hover:border-rizzotto-blood-500 cursor-pointer'
                      : 'border-rizzotto-iron-700 bg-rizzotto-iron-900/80 cursor-default',
              ].join(' ')}
            >
              {map.image_url && (
                <img
                  src={map.image_url}
                  alt=""
                  className="absolute inset-0 w-full h-full object-cover opacity-20"
                />
              )}
              <div className="relative z-10 px-2">
                <p
                  className={`text-xs font-semibold leading-tight font-display ${
                    isBanned
                      ? 'text-rizzotto-stone-500'
                      : isPicked
                        ? 'text-rizzotto-gold-400'
                        : 'text-rizzotto-stone-200'
                  }`}
                >
                  {map.name}
                </p>
              </div>
              {isBanned && (
                <div className="absolute inset-0 flex items-center justify-center bg-rizzotto-iron-950/70">
                  <span className="font-display text-xs font-bold tracking-widest text-rizzotto-blood-500 uppercase">
                    Banned
                  </span>
                </div>
              )}
              {isPicked && (
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  className="absolute inset-0 flex items-center justify-center bg-rizzotto-gold-500/10"
                >
                  <span className="font-display text-xs font-bold tracking-widest text-rizzotto-gold-400 uppercase">
                    Picked
                  </span>
                </motion.div>
              )}
            </motion.button>
          );
        })}
      </div>

      {/* Picked map highlight */}
      {pickedMap && (
        <motion.div
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
          className="rounded-lg border border-rizzotto-gold-500/50 bg-rizzotto-iron-900 px-8 py-4 text-center shadow-rizzotto-banner"
        >
          <p className="text-xs text-rizzotto-stone-500 uppercase tracking-widest mb-1">
            Battlefield
          </p>
          <p className="font-display text-2xl font-bold text-rizzotto-gold-400">
            {pickedMap.name}
          </p>
        </motion.div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Blind Faction Pick Phase
// ---------------------------------------------------------------------------

interface BlindPickPhaseProps {
  matchId: string;
  decision: MatchDecisionState;
  currentUserId: string;
  factions: FactionWithStatsDto[];
}

function BlindPickPhase({
  matchId,
  decision,
  currentUserId,
  factions,
}: BlindPickPhaseProps) {
  const [selectedFactionId, setSelectedFactionId] = useState<string | null>(null);
  const [locking, setLocking] = useState(false);

  const bp = decision.blindPick;
  const isPlayer1 = decision.topPlayerId === currentUserId;
  const myLocked = isPlayer1 ? bp?.player1Locked : bp?.player2Locked;
  const revealed = bp?.revealedAt != null;

  async function handleLockIn() {
    if (!selectedFactionId) return;
    setLocking(true);
    try {
      await lockBlindPick(matchId, selectedFactionId);
    } catch {
      // socket will sync
    } finally {
      setLocking(false);
    }
  }

  if (revealed && bp) {
    const myFactionId = isPlayer1 ? bp.player1FactionId : bp.player2FactionId;
    const opponentFactionId = isPlayer1 ? bp.player2FactionId : bp.player1FactionId;
    const myEntry = factions.find((f) => f.faction.id === myFactionId);
    const opponentEntry = factions.find((f) => f.faction.id === opponentFactionId);

    return (
      <div className="flex flex-col items-center gap-6">
        <h2 className="font-display text-xl font-semibold text-rizzotto-gold-400 tracking-wider">
          Factions Revealed
        </h2>
        <div className="flex gap-8">
          <motion.div
            initial={{ opacity: 0, x: -20 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: 0.1 }}
            className="flex flex-col items-center gap-3"
          >
            <span className="text-xs text-rizzotto-stone-500 uppercase tracking-widest">You</span>
            {myEntry && (
              <FactionBadge
                colorHex={myEntry.faction.color_hex}
                initials={myEntry.faction.initials}
                name={myEntry.faction.name}
                size="lg"
                iconUrl={myEntry.faction.icon_url}
              />
            )}
            <span className="text-sm font-semibold text-rizzotto-stone-200">
              {myEntry?.faction.name ?? '—'}
            </span>
          </motion.div>

          <div className="flex items-center text-rizzotto-stone-600 font-display text-2xl">
            vs
          </div>

          <motion.div
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: 0.2 }}
            className="flex flex-col items-center gap-3"
          >
            <span className="text-xs text-rizzotto-stone-500 uppercase tracking-widest">
              Opponent
            </span>
            {opponentEntry && (
              <FactionBadge
                colorHex={opponentEntry.faction.color_hex}
                initials={opponentEntry.faction.initials}
                name={opponentEntry.faction.name}
                size="lg"
                iconUrl={opponentEntry.faction.icon_url}
              />
            )}
            <span className="text-sm font-semibold text-rizzotto-stone-200">
              {opponentEntry?.faction.name ?? '—'}
            </span>
          </motion.div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center gap-6">
      <h2 className="font-display text-xl font-semibold text-rizzotto-gold-400 tracking-wider">
        Blind Faction Pick
      </h2>

      {myLocked ? (
        <div className="flex flex-col items-center gap-3 text-center">
          <span className="h-8 w-8 rounded-full border-2 border-rizzotto-gold-400 border-t-transparent animate-spin" />
          <p className="text-sm text-rizzotto-stone-400">
            Faction locked. Waiting for opponent…
          </p>
        </div>
      ) : (
        <>
          <p className="text-sm text-rizzotto-stone-400 text-center max-w-sm">
            Choose your faction. Your pick will be revealed only after both players lock in.
          </p>

          <div className="grid grid-cols-4 gap-2 max-w-md w-full">
            {factions.map(({ faction }) => (
              <button
                key={faction.id}
                type="button"
                onClick={() => setSelectedFactionId(faction.id)}
                className={[
                  'flex flex-col items-center gap-1.5 rounded-md border p-2 transition-all',
                  selectedFactionId === faction.id
                    ? 'border-rizzotto-gold-500 bg-rizzotto-gold-500/10'
                    : 'border-rizzotto-iron-700 bg-rizzotto-iron-900 hover:border-rizzotto-iron-500',
                ].join(' ')}
              >
                <FactionBadge
                  colorHex={faction.color_hex}
                  initials={faction.initials}
                  name={faction.name}
                  size="sm"
                  iconUrl={faction.icon_url}
                />
                <span className="text-[10px] text-rizzotto-stone-400 text-center leading-tight">
                  {faction.name}
                </span>
              </button>
            ))}
          </div>

          <Button
            variant="forge"
            size="md"
            disabled={!selectedFactionId || locking}
            onClick={handleLockIn}
          >
            {locking ? 'Locking…' : 'Lock In'}
          </Button>
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main Page
// ---------------------------------------------------------------------------

type DecisionPhase =
  | 'loading'
  | 'coin_flip'
  | 'map_random'
  | 'map_pick_ban'
  | 'blind_pick'
  | 'ready';

const RANDOM_MODES = new Set(['RANDOM', 'RANDOM_NO_REPEAT', 'HOST_PRESET']);
const BAN_MODES = new Set(['PICK_BAN', 'HOST_PRESET_PICK_BAN', 'RANDOM_PICK_BAN']);

function resolvePhase(d: MatchDecisionState | null): DecisionPhase {
  if (!d) return 'loading';
  if (d.pickedMapId) {
    // Map decided — check blind pick
    if (d.blindPick?.revealedAt) return 'ready';
    if (d.blindPick != null) return 'blind_pick';
    return 'ready';
  }
  if (RANDOM_MODES.has(d.mode)) return 'map_random';
  if (BAN_MODES.has(d.mode)) {
    // Show coin flip briefly first if neither ban has happened
    if (d.bansTop.length === 0 && d.bansBottom.length === 0) return 'coin_flip';
    return 'map_pick_ban';
  }
  return 'coin_flip';
}

export function MatchDecisionPage() {
  const { matchId } = useParams({ from: '/matches/$matchId/decision' });
  const router = useRouter();
  const routerState = useRouterState();
  const { data: user } = useAuthQuery();
  const queryClient = useQueryClient();

  // True when navigated here via "Choose Battlefield" — show coin-toss animation even though
  // the decision already exists in the DB by the time the query resolves.
  const isFreshDecision =
    (routerState.location.state as { freshDecision?: boolean } | null)?.freshDecision === true;

  const [decision, setDecision] = useState<MatchDecisionState | null>(null);
  // True when decision was already in the DB when the page loaded — skip the coin flip animation.
  const [decisionPreloaded, setDecisionPreloaded] = useState(false);
  const [coinFlipDone, setCoinFlipDone] = useState(false);
  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Initial fetch
  const { data: initialDecision, isLoading } = useQuery({
    queryKey: ['match-decision', matchId],
    queryFn: () => getMatchDecision(matchId),
    retry: false,
  });

  useEffect(() => {
    if (initialDecision) {
      setDecision(initialDecision);
      if (!isFreshDecision) {
        setDecisionPreloaded(true); // came from server, not a fresh toss on this page
      }
    }
  }, [initialDecision, isFreshDecision]);

  // Factions for blind pick
  const { data: factionsData } = useQuery({
    queryKey: ['factions'],
    queryFn: () => getFactions(),
  });
  // factionsData.data is FactionWithStatsDto[]
  const factions = factionsData?.data ?? [];

  // Socket subscriptions
  useEffect(() => {
    const socket = getSocket();
    if (!socket.connected) socket.connect();

    const handleDecisionUpdate: ServerToClientEvents['match.decision.update'] = (payload) => {
      if (payload.matchId !== matchId) return;
      setDecision((prev) =>
        prev
          ? {
              ...prev,
              bansTop: payload.bansTop,
              bansBottom: payload.bansBottom,
              pickedMapId: payload.pickedMapId,
              decidedAt: payload.decidedAt,
            }
          : prev,
      );
      void queryClient.invalidateQueries({ queryKey: ['match-decision', matchId] });
    };

    const handleDecisionComplete: ServerToClientEvents['match.decision.complete'] = (payload) => {
      if (payload.matchId !== matchId) return;
      setDecision((prev) =>
        prev ? { ...prev, pickedMapId: payload.pickedMapId, decidedAt: payload.decidedAt } : prev,
      );
    };

    const handleBlindPickUpdate: ServerToClientEvents['match.blind-pick.update'] = (payload) => {
      if (payload.matchId !== matchId) return;
      setDecision((prev) =>
        prev
          ? {
              ...prev,
              blindPick: {
                player1Locked: payload.player1Locked,
                player2Locked: payload.player2Locked,
                revealedAt: payload.revealedAt,
                player1FactionId: payload.player1FactionId,
                player2FactionId: payload.player2FactionId,
              },
            }
          : prev,
      );
    };

    socket.on('match.decision.update', handleDecisionUpdate);
    socket.on('match.decision.complete', handleDecisionComplete);
    socket.on('match.blind-pick.update', handleBlindPickUpdate);

    // Fallback polling when socket disconnected
    function startPolling() {
      if (pollingRef.current) return;
      pollingRef.current = setInterval(async () => {
        try {
          const fresh = await getMatchDecision(matchId);
          setDecision(fresh);
        } catch {
          // ignore
        }
      }, 5000);
    }

    function stopPolling() {
      if (pollingRef.current) {
        clearInterval(pollingRef.current);
        pollingRef.current = null;
      }
    }

    socket.on('disconnect', startPolling);
    socket.on('connect', stopPolling);

    if (!socket.connected) startPolling();

    return () => {
      socket.off('match.decision.update', handleDecisionUpdate);
      socket.off('match.decision.complete', handleDecisionComplete);
      socket.off('match.blind-pick.update', handleBlindPickUpdate);
      socket.off('disconnect', startPolling);
      socket.off('connect', stopPolling);
      stopPolling();
    };
  }, [matchId, queryClient]);

  // Fetch match detail to get tournament slug for tournament-specific map pool
  const { data: matchDetail } = useQuery({
    queryKey: ['match-detail', matchId],
    queryFn: () => import('@/lib/api').then((m) => m.getMatchDetail(matchId)),
    retry: false,
  });

  // Map pool — tournament-specific snapshot (falls back to global pool if slug not yet loaded)
  const { data: allMapsData } = useQuery({
    queryKey: ['tournament-maps', matchDetail?.tournament_slug],
    queryFn: () =>
      matchDetail?.tournament_slug
        ? import('@/lib/api').then((m) => m.getTournamentMaps(matchDetail.tournament_slug))
        : import('@/lib/api').then((m) => m.getMaps()),
    enabled: true,
  });

  const allTournamentMaps: MapDto[] = allMapsData?.data ?? [];
  // Für Modi mit active_pool (HOST_PRESET_PICK_BAN, RANDOM_PICK_BAN) nur die 3 aktiven Maps zeigen
  const mapPool: MapDto[] =
    decision && decision.activePool && decision.activePool.length > 0
      ? allTournamentMaps.filter((m) => decision.activePool.includes(m.id))
      : allTournamentMaps;

  // Resolve player names + avatars for the coin flip
  const topPlayer = decision
    ? (matchDetail?.player1?.id === decision.topPlayerId ? matchDetail?.player1 : matchDetail?.player2)
    : null;
  const bottomPlayer = decision
    ? (matchDetail?.player1?.id === decision.bottomPlayerId ? matchDetail?.player1 : matchDetail?.player2)
    : null;

  const isOrganizerOrAdmin =
    user && (user.role === 'ORGANIZER' || user.role === 'MODERATOR' || user.role === 'ADMIN');

  const forceResolveMutation = useMutation({
    mutationFn: () => forceResolveDecision(matchId),
    onSuccess: (data) => {
      setDecision(data);
      void queryClient.invalidateQueries({ queryKey: ['match-decision', matchId] });
    },
  });

  // Phase transitions
  const rawPhase = resolvePhase(decision);
  let phase = rawPhase;
  if (rawPhase === 'coin_flip' && coinFlipDone) {
    phase = RANDOM_MODES.has(decision?.mode ?? '') ? 'map_random' : 'map_pick_ban';
  }

  // Auto-advance from coin flip
  useEffect(() => {
    if (rawPhase === 'coin_flip' && !coinFlipDone) {
      const timer = setTimeout(() => setCoinFlipDone(true), 3500);
      return () => clearTimeout(timer);
    }
  }, [rawPhase, coinFlipDone]);

  if (isLoading || !decision || !user) {
    return (
      <PageShell variant="tight" spacing="loose" className="flex items-center justify-center min-h-[60vh]">
        <div className="flex flex-col items-center gap-3">
          <span className="h-8 w-8 rounded-full border-2 border-rizzotto-gold-400 border-t-transparent animate-spin" />
          <p className="text-sm text-rizzotto-stone-400">Preparing match decision…</p>
        </div>
      </PageShell>
    );
  }

  return (
    <PageShell variant="tight" spacing="base">
      <div className="mb-8 text-center">
        <h1 className="font-display text-2xl font-bold text-rizzotto-stone-100">
          Match Decision
        </h1>
        <p className="mt-1 text-xs text-rizzotto-stone-500 tracking-widest uppercase">
          Match #{matchId.slice(-6)}
        </p>
      </div>

      <div className="rounded-xl border border-rizzotto-iron-600 bg-rizzotto-iron-900/80 shadow-rizzotto-banner p-8">
        <AnimatePresence mode="wait">
          {phase === 'coin_flip' && (
            <motion.div
              key="coin_flip"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.3 }}
            >
              <CoinFlipPhase
                decision={decision}
                currentUserId={user.id}
                topPlayerAvatar={topPlayer?.avatar_url ?? null}
                bottomPlayerAvatar={bottomPlayer?.avatar_url ?? null}
                topPlayerName={topPlayer?.username}
                bottomPlayerName={bottomPlayer?.username}
                skipAnimation={decisionPreloaded}
              />
            </motion.div>
          )}

          {phase === 'map_random' && (
            <motion.div
              key="map_random"
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.4 }}
            >
              <RandomMapPhase pickedMapId={decision.pickedMapId} mapPool={mapPool} />
            </motion.div>
          )}

          {phase === 'map_pick_ban' && (
            <motion.div
              key="map_pick_ban"
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.4 }}
            >
              <PickBanPhase
                decision={decision}
                mapPool={mapPool}
                currentUserId={user.id}
                matchId={matchId}
                onDecisionUpdate={setDecision}
              />
            </motion.div>
          )}

          {phase === 'blind_pick' && (
            <motion.div
              key="blind_pick"
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.4 }}
            >
              <BlindPickPhase
                matchId={matchId}
                decision={decision}
                currentUserId={user.id}
                factions={factions}
              />
            </motion.div>
          )}

          {phase === 'ready' && (
            <motion.div
              key="ready"
              initial={{ opacity: 0, scale: 0.96 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
              className="flex flex-col items-center gap-6 py-4"
            >
              <div className="h-16 w-16 rounded-full border-2 border-rizzotto-gold-400 flex items-center justify-center text-rizzotto-gold-400 text-2xl">
                ⚔
              </div>
              <div className="text-center">
                <h2 className="font-display text-2xl font-bold text-rizzotto-gold-400">
                  Match Ready
                </h2>
                {decision.pickedMapId && mapPool.length > 0 && (
                  <p className="mt-2 text-sm text-rizzotto-stone-400">
                    Battlefield:{' '}
                    <span className="text-rizzotto-stone-200 font-semibold">
                      {mapPool.find((m) => m.id === decision.pickedMapId)?.name ?? '—'}
                    </span>
                  </p>
                )}
              </div>
              <Button
                variant="forge"
                size="lg"
                onClick={() => void router.navigate({ to: '/tournaments/$slug', params: { slug: matchDetail?.tournament_slug ?? '' }, hash: 'my-match' })}
              >
                Start Match
              </Button>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Organizer/Admin escape hatch — force-pick a random map if a player is AFK */}
      {isOrganizerOrAdmin && phase === 'map_pick_ban' && !decision.pickedMapId && (
        <div className="mt-4 flex justify-center">
          <button
            onClick={() => forceResolveMutation.mutate()}
            disabled={forceResolveMutation.isPending}
            className="text-xs text-rizzotto-stone-600 hover:text-rizzotto-stone-400 transition-colors disabled:opacity-50"
          >
            {forceResolveMutation.isPending ? 'Picking…' : 'Organizer: Pick random map'}
          </button>
        </div>
      )}
    </PageShell>
  );
}
