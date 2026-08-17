import { useState, useEffect, useRef } from 'react';
import { useParams, useRouter, useRouterState, Link } from '@tanstack/react-router';
import { motion, AnimatePresence } from 'motion/react';
import { useQuery, useQueryClient, useMutation } from '@tanstack/react-query';
import { useAuthQuery } from '@/lib/auth';
import {
  getMatchDecision,
  forceResolveDecision,
  banMap,
  lockBlindPick,
  lockFactionMatrix,
  banMatrixCell,
  offerFreePickFactions,
  selectFreePickFaction,
  offerOneVThreeFactions,
  selectOneVThreeFaction,
  getFactions,
} from '@/lib/api';
import type { MatchDecisionState, MapDto } from '@/lib/api';
import { getSocket } from '@/lib/socket';
import { toActualCell } from '@/lib/matrix';
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
            className={`absolute inset-0 w-full h-full object-cover transition-opacity duration-100 ${spinning ? 'opacity-80' : 'opacity-100'}`}
          />
        )}
        <div className="relative z-10 text-center px-4 py-2 rounded-md bg-rizzotto-iron-950/65 backdrop-blur-sm">
          <p
            className={`font-display font-bold leading-tight drop-shadow-lg transition-all ${
              spinning
                ? 'text-lg text-rizzotto-stone-100'
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
  const [acting, setActing] = useState(false);
  const [hoveredMapId, setHoveredMapId] = useState<string | null>(null);
  const [mapPreview, setMapPreview] = useState<MapDto | null>(null);

  useEffect(() => {
    if (!mapPreview) return;
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') setMapPreview(null); }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [mapPreview]);

  const isTop = decision.topPlayerId === currentUserId;
  const isBottom = decision.bottomPlayerId === currentUserId;

  // P1 (top, coin-flip winner) bans first, P2 (bottom) then picks from remaining two.
  const topBanCount = decision.bansTop.length;
  const bottomBanCount = decision.bansBottom.length;
  const isTopTurn = topBanCount === 0;
  const isBottomTurn = topBanCount === 1 && bottomBanCount === 0;
  const isMyTurn = (isTop && isTopTurn) || (isBottom && isBottomTurn);

  const allBannedIds = [...decision.bansTop, ...decision.bansBottom];

  async function handleAction(mapId: string) {
    setActing(true);
    try {
      const updated = await banMap(matchId, mapId);
      onDecisionUpdate(updated);
    } catch {
      // ignore — socket will sync
    } finally {
      setActing(false);
    }
  }

  const phase =
    decision.pickedMapId != null
      ? 'complete'
      : !isMyTurn
        ? 'waiting'
        : isTopTurn
          ? 'banning'
          : 'picking';

  const pickedMap = mapPool.find((m) => m.id === decision.pickedMapId);
  const actionLabel = phase === 'banning' ? 'BAN' : 'PICK';

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
            {topBanCount === 0
              ? 'Waiting for opponent to ban a map…'
              : 'Waiting for opponent to pick the map…'}
          </span>
        )}
        {phase === 'banning' && (
          <span className="text-rizzotto-stone-200">Your turn — ban one map from the pool.</span>
        )}
        {phase === 'picking' && (
          <span className="text-rizzotto-stone-200">Your turn — pick the map you want to play on.</span>
        )}
      </div>

      {/* Map grid */}
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-4 w-full max-w-4xl">
        {mapPool.map((map) => {
          const isBanned = allBannedIds.includes(map.id);
          const isPicked = map.id === decision.pickedMapId;
          const isClickable = (phase === 'banning' || phase === 'picking') && !isBanned && !acting;
          const isHovered = hoveredMapId === map.id;

          return (
            <div key={map.id} className="flex flex-col gap-1">
              <motion.button
                type="button"
                disabled={!isClickable}
                onClick={() => isClickable && handleAction(map.id)}
                onMouseEnter={() => setHoveredMapId(map.id)}
                onMouseLeave={() => setHoveredMapId(null)}
                whileHover={isClickable ? { scale: 1.03, y: -2 } : {}}
                whileTap={isClickable ? { scale: 0.97 } : {}}
                className={[
                  'relative overflow-hidden rounded-md border aspect-[4/3] transition-all',
                  isBanned
                    ? 'border-rizzotto-iron-700 bg-rizzotto-iron-900/60 grayscale'
                    : isPicked
                      ? 'border-rizzotto-iron-700 bg-rizzotto-iron-900 shadow-rizzotto-emboss'
                      : isClickable
                        ? 'border-rizzotto-iron-600 bg-rizzotto-iron-900 hover:border-rizzotto-iron-500 cursor-pointer'
                        : 'border-rizzotto-iron-700 bg-rizzotto-iron-900/80 cursor-default',
                ].join(' ')}
              >
                {map.image_url && (
                  <img
                    src={map.image_url}
                    alt=""
                    className={`absolute inset-0 h-full w-full object-cover ${
                      isBanned ? 'opacity-40' : 'opacity-90'
                    }`}
                  />
                )}
                {/* Name sits on a bottom scrim so it stays legible over the map */}
                <div className="absolute inset-x-0 bottom-0 z-10 bg-gradient-to-t from-rizzotto-iron-950 via-rizzotto-iron-950/80 to-transparent px-2.5 pb-2 pt-6">
                  <p
                    className={`text-sm font-semibold leading-tight font-display ${
                      isBanned ? 'text-rizzotto-stone-400' : 'text-rizzotto-stone-100'
                    }`}
                  >
                    {map.name}
                  </p>
                </div>

                {/* Banned: red vignette (glow from the edges) + faint cross-out */}
                {isBanned && (
                  <div
                    className="pointer-events-none absolute inset-0 z-20 overflow-hidden rounded-md"
                    style={{ boxShadow: 'inset 0 0 34px 8px rgba(190,40,40,0.6)' }}
                  >
                    <div className="absolute left-1/2 top-1/2 h-px w-[150%] -translate-x-1/2 -translate-y-1/2 -rotate-[30deg] bg-rizzotto-blood-500/50" />
                  </div>
                )}

                {/* Picked: persistent green vignette + neutral label */}
                {isPicked && (
                  <motion.div
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    className="pointer-events-none absolute inset-0 z-20 flex items-start justify-center rounded-md pt-2"
                    style={{ boxShadow: 'inset 0 0 34px 8px rgba(16,185,129,0.6)' }}
                  >
                    <span className="rounded bg-rizzotto-iron-950/70 px-2 py-0.5 font-display text-xs font-bold uppercase tracking-widest text-rizzotto-stone-100">
                      Picked
                    </span>
                  </motion.div>
                )}

                {/* Hover: red vignette while banning, green while picking */}
                {isClickable && isHovered && (
                  <motion.div
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    transition={{ duration: 0.1 }}
                    className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center rounded-md"
                    style={{ boxShadow: `inset 0 0 34px 9px ${phase === 'banning' ? 'rgba(190,40,40,0.6)' : 'rgba(16,185,129,0.6)'}` }}
                  >
                    <span className="rounded bg-rizzotto-iron-950/70 px-2 py-0.5 font-display text-sm font-black uppercase tracking-widest text-rizzotto-stone-100">
                      {actionLabel}
                    </span>
                  </motion.div>
                )}
              </motion.button>
              {map.image_url && (
                <button
                  type="button"
                  onClick={() => setMapPreview(map)}
                  className="text-[10px] text-stone-500 hover:text-rizzotto-gold-400 transition-colors leading-none py-0.5"
                >
                  ⊕ View
                </button>
              )}
            </div>
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

      {/* Map preview lightbox */}
      {mapPreview && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4"
          onClick={() => setMapPreview(null)}
        >
          <div className="relative flex flex-col items-center gap-2 w-full h-full" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between w-full px-1 shrink-0">
              <span className="text-white font-semibold">{mapPreview.name}</span>
              <button
                type="button"
                onClick={() => setMapPreview(null)}
                className="text-white/60 hover:text-white text-xl leading-none transition-colors"
                aria-label="Close"
              >
                ✕
              </button>
            </div>
            <img
              src={mapPreview.image_url!}
              alt={mapPreview.name}
              className="w-full h-full object-contain"
            />
          </div>
        </div>
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
  pickedMapName?: string | null;
  pickedMapImageUrl?: string | null;
  restrictedFactions?: string[];
  factionAllowlist?: string[];
}

function BlindPickPhase({
  matchId,
  decision,
  currentUserId,
  factions,
  pickedMapName,
  pickedMapImageUrl,
  restrictedFactions = [],
  factionAllowlist = [],
}: BlindPickPhaseProps) {
  const queryClient = useQueryClient();
  const [selectedFactionId, setSelectedFactionId] = useState<string | null>(null);
  const [locking, setLocking] = useState(false);
  const [lockError, setLockError] = useState<string | null>(null);
  const [mapLightbox, setMapLightbox] = useState(false);

  useEffect(() => {
    if (!mapLightbox) return;
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') setMapLightbox(false); }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [mapLightbox]);

  const bp = decision.blindPick;
  // Use match player ordering (player1_id/player2_id) not coin-flip ordering
  // (topPlayerId). The backend sets player1_locked_at for match.player1_id.
  const isMatchPlayer1 = decision.matchPlayer1Id
    ? decision.matchPlayer1Id === currentUserId
    : decision.topPlayerId === currentUserId; // fallback for older responses
  const myLocked = isMatchPlayer1 ? bp?.player1Locked : bp?.player2Locked;
  const revealed = bp?.revealedAt != null;

  async function handleLockIn() {
    if (!selectedFactionId) return;
    setLocking(true);
    setLockError(null);
    try {
      await lockBlindPick(matchId, selectedFactionId);
      // Immediately refetch so the UI updates even if the socket misses the event
      await queryClient.invalidateQueries({ queryKey: ['match-decision', matchId] });
    } catch (err) {
      setLockError(err instanceof Error ? err.message : 'Lock failed — please try again.');
    } finally {
      setLocking(false);
    }
  }

  if (revealed && bp) {
    const myFactionId = isMatchPlayer1 ? bp.player1FactionId : bp.player2FactionId;
    const opponentFactionId = isMatchPlayer1 ? bp.player2FactionId : bp.player1FactionId;
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
      {pickedMapName && (
        <p className="text-sm text-rizzotto-stone-400">
          Map:{' '}
          {pickedMapImageUrl ? (
            <button
              type="button"
              onClick={() => setMapLightbox(true)}
              className="font-semibold text-stone-200 hover:text-rizzotto-gold-400 underline-offset-2 hover:underline transition-colors"
            >
              {pickedMapName}
            </button>
          ) : (
            <span className="font-semibold text-stone-200">{pickedMapName}</span>
          )}
        </p>
      )}

      {/* Map lightbox */}
      {mapLightbox && pickedMapImageUrl && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4"
          onClick={() => setMapLightbox(false)}
        >
          <div className="relative flex flex-col items-center gap-2 w-full h-full">
            <div className="flex items-center justify-between w-full px-1 shrink-0">
              <span className="text-white font-semibold">{pickedMapName}</span>
              {myLocked && bp && (
                <BlindPickCountdown
                  firstLockedAt={bp.firstLockedAt ?? null}
                  timeoutMs={decision.isOpenPlay ? 5 * 60 * 1000 : 2 * 60 * 1000}
                />
              )}
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
              src={pickedMapImageUrl}
              alt={pickedMapName ?? ''}
              className="w-full h-full object-contain"
            />
          </div>
        </div>
      )}

      {myLocked ? (
        <div className="flex flex-col items-center gap-3 text-center">
          <span className="h-8 w-8 rounded-full border-2 border-rizzotto-gold-400 border-t-transparent animate-spin" />
          <p className="text-sm text-rizzotto-stone-400">
            Faction locked. Waiting for opponent…
          </p>
          <BlindPickCountdown
            firstLockedAt={bp?.firstLockedAt ?? null}
            timeoutMs={decision.isOpenPlay ? 5 * 60 * 1000 : 2 * 60 * 1000}
          />
        </div>
      ) : (
        <>
          <p className="text-sm text-rizzotto-stone-400 text-center max-w-sm">
            Choose your faction. Your pick will be revealed only after both players lock in.
          </p>

          <div className="grid grid-cols-3 gap-2 w-full sm:grid-cols-4 lg:grid-cols-6">
            {factions.map(({ faction }) => {
              // Restricted factions are nerfed, not banned — keep them pickable.
              const isRestricted = restrictedFactions.includes(faction.id);
              const isDisabled = factionAllowlist.length > 0 && !factionAllowlist.includes(faction.id);
              return (
              <button
                key={faction.id}
                type="button"
                disabled={isDisabled}
                title={
                  isDisabled
                    ? 'Not permitted in this tournament'
                    : isRestricted
                      ? 'Restricted (nerfed) — does not count toward the leaderboard'
                      : undefined
                }
                onClick={() => !isDisabled && setSelectedFactionId(faction.id)}
                className={[
                  'flex flex-col items-center gap-1.5 rounded-sm border p-2 text-center',
                  'transition-[border-color,background-color] duration-150',
                  isDisabled
                    ? 'cursor-not-allowed opacity-40 border-rizzotto-iron-700 bg-rizzotto-iron-900'
                    : selectedFactionId === faction.id
                      ? 'border-rizzotto-gold-500 bg-rizzotto-iron-800'
                      : 'border-rizzotto-iron-600 bg-rizzotto-iron-900 hover:border-rizzotto-gold-500/60 hover:bg-rizzotto-iron-800',
                ].join(' ')}
              >
                <FactionBadge
                  colorHex={faction.color_hex}
                  initials={faction.initials}
                  name={faction.name}
                  size="lg"
                  iconUrl={faction.icon_url}
                />
                <span className={[
                  'line-clamp-2 font-display text-[10px] uppercase leading-tight tracking-wide',
                  selectedFactionId === faction.id ? 'text-rizzotto-gold-300' : 'text-rizzotto-stone-300',
                ].join(' ')}>
                  {faction.name}
                </span>
              </button>
              );
            })}
          </div>

          <Button
            variant="forge"
            size="md"
            disabled={!selectedFactionId || locking}
            onClick={handleLockIn}
          >
            {locking ? 'Locking…' : 'Lock In'}
          </Button>
          {lockError && (
            <p className="text-sm text-red-400 text-center">{lockError}</p>
          )}
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// 3×3 Faction Matrix Phase
// ---------------------------------------------------------------------------

function MatrixCountdown({ lastActionAt, bansCount }: { lastActionAt: string; bansCount: number }) {
  const [label, setLabel] = useState<string | null>(null);

  useEffect(() => {
    const windowMs = 30_000; // 30s for every ban and the final pick (matches the backend)
    const deadline = new Date(new Date(lastActionAt).getTime() + windowMs);
    function tick() {
      const diff = deadline.getTime() - Date.now();
      if (diff <= 0) { setLabel('Auto-banning now…'); return; }
      setLabel(`Auto-ban in ${Math.ceil(diff / 1000)}s`);
    }
    tick();
    const id = setInterval(tick, 500);
    return () => clearInterval(id);
  }, [lastActionAt, bansCount]);

  if (!label) return null;
  return <p className="text-xs text-rizzotto-stone-500 font-mono">{label}</p>;
}

type PlayerRef = { id: string; username: string; avatar_url?: string | null } | null | undefined;

interface FactionMatrixPhaseProps {
  matchId: string;
  decision: MatchDecisionState;
  currentUserId: string;
  factions: FactionWithStatsDto[];
  rowPlayer?: PlayerRef;
  colPlayer?: PlayerRef;
  restrictedFactions?: string[];
  factionAllowlist?: string[];
}

function FactionMatrixPhase({ matchId, decision, currentUserId, factions, rowPlayer, colPlayer, restrictedFactions = [], factionAllowlist = [] }: FactionMatrixPhaseProps) {
  const queryClient = useQueryClient();
  const [selectedFactions, setSelectedFactions] = useState<string[]>([]);
  const [locking, setLocking] = useState(false);
  const [lockError, setLockError] = useState<string | null>(null);
  const [hoveredCell, setHoveredCell] = useState<string | null>(null);

  const mx = decision.factionMatrix;
  const isPlayer1 = decision.matchPlayer1Id
    ? decision.matchPlayer1Id === currentUserId
    : decision.topPlayerId === currentUserId;

  const myLocked = isPlayer1 ? mx?.p1Locked : mx?.p2Locked;
  const revealed = Boolean(mx?.revealedAt);
  const decided = Boolean(mx?.decidedAt);
  const bans = mx?.bans ?? [];

  let subPhase: 'blind' | 'waiting' | 'ban' | 'complete';
  if (decided) subPhase = 'complete';
  else if (revealed) subPhase = 'ban';
  else if (myLocked) subPhase = 'waiting';
  else subPhase = 'blind';

  // Balanced 1-2-2-2 ban order (must match the backend, faction-matrix.ts):
  // Top (coin-toss winner) bans 1, then Bottom 2 / Top 2 / Bottom 2 — Bottom makes
  // the last ban, then TOP picks the final matchup (so no one bans-last AND picks).
  const BAN_ACTOR_IS_TOP = [true, false, false, true, true, false, false] as const;
  const myTurn = (): boolean => {
    if (!mx || !revealed || decided) return false;
    if (bans.length >= 7) return currentUserId === mx.topPlayerId; // coin-toss winner picks
    return BAN_ACTOR_IS_TOP[bans.length] ? currentUserId === mx.topPlayerId : currentUserId === mx.bottomPlayerId;
  };
  const isMyTurn = myTurn();
  const isPick = bans.length >= 7;

  async function handleLock() {
    if (selectedFactions.length !== 3) return;
    setLocking(true);
    setLockError(null);
    try {
      await lockFactionMatrix(matchId, selectedFactions);
      await queryClient.invalidateQueries({ queryKey: ['match-decision', matchId] });
    } catch (err) {
      setLockError(err instanceof Error ? err.message : 'Lock failed — try again.');
    } finally {
      setLocking(false);
    }
  }

  async function handleCellAction(row: number, col: number) {
    if (!isMyTurn) return;
    const cell = `${row},${col}`;
    if (bans.includes(cell)) return;
    try {
      await banMatrixCell(matchId, row, col);
      await queryClient.invalidateQueries({ queryKey: ['match-decision', matchId] });
    } catch { /* ignore, socket will update */ }
  }

  function toggleFaction(id: string) {
    setSelectedFactions((prev) => {
      if (prev.includes(id)) return prev.filter((f) => f !== id);
      if (prev.length >= 3) return prev;
      return [...prev, id];
    });
  }

  // #43: fill the selection with 3 random pickable factions (allowlist respected,
  // restricted stay eligible).
  function pickRandom3() {
    const pool = factions
      .map((f) => f.faction.id)
      .filter((id) => factionAllowlist.length === 0 || factionAllowlist.includes(id));
    for (let i = pool.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [pool[i], pool[j]] = [pool[j]!, pool[i]!];
    }
    setSelectedFactions(pool.slice(0, 3));
  }

  const p1Factions = mx?.p1Factions ?? [];
  const p2Factions = mx?.p2Factions ?? [];

  // Complete: show final matchup
  if (subPhase === 'complete' && mx) {
    const pickedRow = mx.pickedCell ? Number(mx.pickedCell.split(',')[0]) : null;
    const pickedCol = mx.pickedCell ? Number(mx.pickedCell.split(',')[1]) : null;
    const myFId = isPlayer1 ? (pickedRow !== null ? p1Factions[pickedRow] : null) : (pickedCol !== null ? p2Factions[pickedCol] : null);
    const oppFId = isPlayer1 ? (pickedCol !== null ? p2Factions[pickedCol] : null) : (pickedRow !== null ? p1Factions[pickedRow] : null);
    const myEntry = factions.find((f) => f.faction.id === myFId);
    const oppEntry = factions.find((f) => f.faction.id === oppFId);
    return (
      <div className="flex flex-col items-center gap-6">
        <h2 className="font-display text-xl font-semibold text-rizzotto-gold-400 tracking-wider">Matchup Decided</h2>
        <div className="flex gap-8">
          <div className="flex flex-col items-center gap-3">
            <span className="text-xs text-rizzotto-stone-500 uppercase tracking-widest">You</span>
            {myEntry && <FactionBadge colorHex={myEntry.faction.color_hex} initials={myEntry.faction.initials} name={myEntry.faction.name} size="lg" iconUrl={myEntry.faction.icon_url} />}
            <span className="text-sm font-semibold text-rizzotto-stone-200">{myEntry?.faction.name ?? '—'}</span>
          </div>
          <div className="flex items-center text-rizzotto-stone-600 font-display text-2xl">vs</div>
          <div className="flex flex-col items-center gap-3">
            <span className="text-xs text-rizzotto-stone-500 uppercase tracking-widest">Opponent</span>
            {oppEntry && <FactionBadge colorHex={oppEntry.faction.color_hex} initials={oppEntry.faction.initials} name={oppEntry.faction.name} size="lg" iconUrl={oppEntry.faction.icon_url} />}
            <span className="text-sm font-semibold text-rizzotto-stone-200">{oppEntry?.faction.name ?? '—'}</span>
          </div>
        </div>
      </div>
    );
  }

  // Waiting for opponent to lock
  if (subPhase === 'waiting') {
    return (
      <div className="flex flex-col items-center gap-3 text-center">
        <span className="h-8 w-8 rounded-full border-2 border-rizzotto-gold-400 border-t-transparent animate-spin" />
        <p className="text-sm text-rizzotto-stone-400">Factions locked. Waiting for opponent…</p>
        <BlindPickCountdown firstLockedAt={mx?.firstLockedAt ?? null} timeoutMs={2 * 60 * 1000} />
      </div>
    );
  }

  // Ban/pick grid
  if (subPhase === 'ban' && mx) {
    const bansLeft = 7 - bans.length;
    const turnLabel = isPick ? 'Pick your matchup' : `${bansLeft} ban${bansLeft !== 1 ? 's' : ''} left`;
    const whoseTurnLabel = isMyTurn ? 'Your turn' : "Opponent's turn";

    // #7: the viewer always sees themselves on the left (rows). The matrix model
    // fixes rows = matchPlayer1 (p1Factions), cols = player2 (p2Factions). When the
    // viewer is player 2 we transpose the display — their factions run down the
    // left — and remap every ban/pick click back to the real (row,col) so bans
    // still land on the correct cell. Spectators keep the default (player 1 left).
    const transpose = !!colPlayer && currentUserId === colPlayer.id;
    const rowFactionIds = transpose ? p2Factions : p1Factions;
    const colFactionIds = transpose ? p1Factions : p2Factions;
    const axisRowPlayer = transpose ? colPlayer : rowPlayer;
    const axisColPlayer = transpose ? rowPlayer : colPlayer;
    const toActual = (dispRow: number, dispCol: number): [number, number] =>
      toActualCell(transpose, dispRow, dispCol);

    return (
      <div className="flex flex-col items-center gap-6">
        <div className="text-center">
          <h2 className="font-display text-xl font-semibold text-rizzotto-gold-400 tracking-wider">3×3 Faction Matrix</h2>
          <p className="mt-1 text-sm text-rizzotto-stone-400">{whoseTurnLabel} · {turnLabel}</p>
          {isMyTurn && mx.lastActionAt && <MatrixCountdown lastActionAt={mx.lastActionAt} bansCount={mx.bans.length} />}
        </div>

        <div className="mx-auto grid max-w-[720px] gap-x-3 gap-y-2" style={{ gridTemplateColumns: '3.5rem minmax(0, 1fr)' }}>
          {/* empty top-left corner */}
          <div aria-hidden />
          {/* Top axis — opponent (column player), centered over the grid column (middle cell) */}
          <div className="flex flex-col items-center gap-1">
            {axisColPlayer?.avatar_url ? (
              <img src={axisColPlayer.avatar_url} alt="" className="rounded-full object-cover border border-rizzotto-iron-600" style={{ width: 44, height: 44 }} />
            ) : (
              <span className="rounded-full bg-rizzotto-iron-600 inline-flex items-center justify-center text-lg font-semibold text-rizzotto-stone-300 select-none" style={{ width: 44, height: 44 }}>
                {(axisColPlayer?.username ?? '?').slice(0, 1).toUpperCase()}
              </span>
            )}
            <span className="max-w-[9rem] truncate text-xs font-semibold text-rizzotto-stone-200">
              {axisColPlayer?.id === currentUserId ? 'You' : (axisColPlayer?.username ?? '—')}
            </span>
          </div>
          {/* Left axis — viewer (row player), vertically centered beside the grid */}
          <div className="flex flex-col items-center justify-center gap-1">
            {axisRowPlayer?.avatar_url ? (
              <img src={axisRowPlayer.avatar_url} alt="" className="rounded-full object-cover border border-rizzotto-iron-600" style={{ width: 44, height: 44 }} />
            ) : (
              <span className="rounded-full bg-rizzotto-iron-600 inline-flex items-center justify-center text-lg font-semibold text-rizzotto-stone-300 select-none" style={{ width: 44, height: 44 }}>
                {(axisRowPlayer?.username ?? '?').slice(0, 1).toUpperCase()}
              </span>
            )}
            <span className="w-full truncate text-center text-[11px] font-semibold text-rizzotto-stone-200">
              {axisRowPlayer?.id === currentUserId ? 'You' : (axisRowPlayer?.username ?? '—')}
            </span>
          </div>
          {/* Grid of matchup cells */}
          <div className="grid grid-cols-3 gap-[3px] bg-rizzotto-stone-400 rounded overflow-hidden">
          {[0, 1, 2].map((dispRow) =>
            [0, 1, 2].map((dispCol) => {
              // Map the displayed position back to the real (row,col) so bans/picks
              // hit the correct cell regardless of transpose.
              const [aRow, aCol] = toActual(dispRow, dispCol);
              const cell = `${aRow},${aCol}`;
              const isBanned = bans.includes(cell);
              // Left sub-cell = viewer's (row) faction, right = opponent's (col) faction.
              const p1Entry = factions.find((f) => f.faction.id === rowFactionIds[dispRow]);
              const p2Entry = factions.find((f) => f.faction.id === colFactionIds[dispCol]);
              const isHovered = hoveredCell === cell && isMyTurn && !isBanned;
              const actionLabel = isPick ? 'PICK' : 'BAN';

              return (
                <button
                  key={cell}
                  type="button"
                  disabled={isBanned || !isMyTurn}
                  onClick={() => void handleCellAction(aRow, aCol)}
                  onMouseEnter={() => setHoveredCell(cell)}
                  onMouseLeave={() => setHoveredCell(null)}
                  className={[
                    'relative grid grid-cols-[1fr_auto_1fr] overflow-hidden',
                    'transition-[box-shadow,background-color,opacity] duration-150',
                    isBanned
                      ? 'bg-rizzotto-iron-900/40 opacity-50 cursor-default'
                      : isHovered
                        ? 'bg-rizzotto-iron-800 cursor-pointer'
                        : isMyTurn
                          ? 'bg-rizzotto-iron-900 cursor-pointer'
                          : 'bg-rizzotto-iron-900 cursor-default',
                  ].join(' ')}
                >
                  {/* Banned: red vignette (glow from the edges) + faint cross-out */}
                  {isBanned && (
                    <div
                      className="pointer-events-none absolute inset-0 z-20 overflow-hidden rounded"
                      style={{ boxShadow: 'inset 0 0 22px 6px rgba(190,40,40,0.55)' }}
                    >
                      <div className="absolute left-1/2 top-1/2 h-px w-[141%] -translate-x-1/2 -translate-y-1/2 rotate-45 bg-rizzotto-blood-500/60" />
                    </div>
                  )}
                  {/* Hover: red vignette while banning, green while picking */}
                  {isHovered && (
                    <div
                      className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center rounded"
                      style={{ boxShadow: `inset 0 0 26px 7px ${isPick ? 'rgba(16,185,129,0.6)' : 'rgba(190,40,40,0.6)'}` }}
                    >
                      <span className="rounded bg-rizzotto-iron-950/70 px-2 py-0.5 font-display text-sm font-bold uppercase tracking-widest text-rizzotto-stone-100">
                        {actionLabel}
                      </span>
                    </div>
                  )}
                  {/* Row player's faction for this row */}
                  <div className="flex flex-col items-center justify-center gap-1 p-2">
                    {p1Entry
                      ? <FactionBadge colorHex={p1Entry.faction.color_hex} initials={p1Entry.faction.initials} name={p1Entry.faction.name} size="lg" iconUrl={p1Entry.faction.icon_url} />
                      : <span style={{ width: 60, height: 60 }} />}
                    <span className="text-[11px] text-rizzotto-stone-300 text-center leading-tight line-clamp-2 w-full">{p1Entry?.faction.name ?? '?'}</span>
                  </div>
                  {/* Vertical divider with "vs" in the middle */}
                  <div className="flex flex-col items-center self-stretch py-3">
                    <div className="flex-1 w-px bg-rizzotto-iron-500" />
                    <span className="text-[9px] font-semibold text-rizzotto-stone-500 tracking-wide py-1 select-none">vs</span>
                    <div className="flex-1 w-px bg-rizzotto-iron-500" />
                  </div>
                  {/* Col player's faction for this col */}
                  <div className="flex flex-col items-center justify-center gap-1 p-2">
                    {p2Entry
                      ? <FactionBadge colorHex={p2Entry.faction.color_hex} initials={p2Entry.faction.initials} name={p2Entry.faction.name} size="lg" iconUrl={p2Entry.faction.icon_url} />
                      : <span style={{ width: 60, height: 60 }} />}
                    <span className="text-[11px] text-rizzotto-stone-300 text-center leading-tight line-clamp-2 w-full">{p2Entry?.faction.name ?? '?'}</span>
                  </div>
                </button>
              );
            })
          )}
          </div>
        </div>
      </div>
    );
  }

  // Blind pick (default: subPhase === 'blind')
  return (
    <div className="flex flex-col items-center gap-6">
      <h2 className="font-display text-xl font-semibold text-rizzotto-gold-400 tracking-wider">Pick 3 Factions</h2>
      <p className="text-sm text-rizzotto-stone-400 text-center max-w-sm">
        Choose 3 factions secretly — the matchup grid is revealed only after both players lock in.
        ({selectedFactions.length}/3 selected)
      </p>
      {/* Show countdown if opponent already locked — this player is being timed */}
      {mx?.firstLockedAt && (
        <BlindPickCountdown firstLockedAt={mx.firstLockedAt} timeoutMs={2 * 60 * 1000} />
      )}

      <div className="grid grid-cols-3 gap-2 w-full sm:grid-cols-4 lg:grid-cols-6">
        {factions.map(({ faction }) => {
          const isSelected = selectedFactions.includes(faction.id);
          // Restricted factions are nerfed, not banned — keep them pickable.
          const isRestricted = restrictedFactions.includes(faction.id);
          const isBanned = factionAllowlist.length > 0 && !factionAllowlist.includes(faction.id);
          const isDisabled = isBanned || (!isSelected && selectedFactions.length >= 3);
          return (
            <button
              key={faction.id}
              type="button"
              onClick={() => toggleFaction(faction.id)}
              disabled={isDisabled}
              title={isRestricted && !isBanned ? 'Restricted (nerfed) — does not count toward the leaderboard' : undefined}
              className={[
                'flex flex-col items-center gap-1.5 rounded-sm border p-2 text-center',
                'transition-[border-color,background-color,opacity] duration-150',
                isSelected
                  ? 'border-rizzotto-gold-500 bg-rizzotto-iron-800'
                  : isDisabled
                    ? 'border-rizzotto-iron-700 bg-rizzotto-iron-900/40 opacity-40 cursor-default'
                    : 'border-rizzotto-iron-600 bg-rizzotto-iron-900 hover:border-rizzotto-gold-500/60 hover:bg-rizzotto-iron-800',
              ].join(' ')}
            >
              <FactionBadge colorHex={faction.color_hex} initials={faction.initials} name={faction.name} size="lg" iconUrl={faction.icon_url} />
              <span className={[
                'line-clamp-2 font-display text-[10px] uppercase leading-tight tracking-wide',
                isSelected ? 'text-rizzotto-gold-300' : 'text-rizzotto-stone-300',
              ].join(' ')}>
                {faction.name}
              </span>
            </button>
          );
        })}
      </div>

      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={pickRandom3}
          className="rounded-sm border border-rizzotto-iron-600 bg-rizzotto-iron-900 px-3 py-2 text-xs font-semibold text-rizzotto-stone-300 transition-colors hover:border-rizzotto-gold-500/60 hover:text-rizzotto-gold-300"
        >
          🎲 Random 3
        </button>
        <Button variant="forge" size="md" disabled={selectedFactions.length !== 3 || locking} onClick={handleLock}>
          {locking ? 'Locking…' : 'Lock In (3 Factions)'}
        </Button>
      </div>
      {lockError && <p className="text-sm text-red-400 text-center">{lockError}</p>}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Free Pick — mixed matchup mini-pick (pick-later offers 3, fixed chooses 1)
// ---------------------------------------------------------------------------

interface FreePickMiniPhaseProps {
  matchId: string;
  decision: MatchDecisionState;
  currentUserId: string;
  factions: FactionWithStatsDto[];
  rowPlayer?: PlayerRef;
  colPlayer?: PlayerRef;
  restrictedFactions?: string[];
  factionAllowlist?: string[];
}

function FreePickMiniPhase({ matchId, decision, currentUserId, factions, rowPlayer, colPlayer, restrictedFactions = [], factionAllowlist = [] }: FreePickMiniPhaseProps) {
  const queryClient = useQueryClient();
  const [selected, setSelected] = useState<string[]>([]);
  const [hovered, setHovered] = useState<string | null>(null);
  const [acting, setActing] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const fp = decision.freePick;
  const mx = decision.factionMatrix;
  const fixedIsP1 = fp?.p1FactionId != null;
  const viewerIsP1 = currentUserId === rowPlayer?.id;
  const viewerIsP2 = currentUserId === colPlayer?.id;
  const viewerIsPlayer = viewerIsP1 || viewerIsP2;
  const viewerIsFixed = viewerIsPlayer && viewerIsP1 === fixedIsP1;
  const viewerIsPickLater = viewerIsPlayer && !viewerIsFixed;

  const revealed = Boolean(mx?.revealedAt);
  const fixedFactionId = fixedIsP1 ? fp?.p1FactionId : fp?.p2FactionId;
  const offered = (fixedIsP1 ? mx?.p2Factions : mx?.p1Factions) ?? [];
  const fixedEntry = factions.find((f) => f.faction.id === fixedFactionId);

  const toggle = (id: string) =>
    setSelected((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : prev.length >= 3 ? prev : [...prev, id]));

  // #43: offer 3 random pickable factions (allowlist respected, restricted eligible).
  const pickRandom3 = () => {
    const pool = factions
      .map((f) => f.faction.id)
      .filter((id) => factionAllowlist.length === 0 || factionAllowlist.includes(id));
    for (let i = pool.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [pool[i], pool[j]] = [pool[j]!, pool[i]!];
    }
    setSelected(pool.slice(0, 3));
  };

  async function submitOffer() {
    if (selected.length !== 3) return;
    setActing(true);
    setErr(null);
    try {
      await offerFreePickFactions(matchId, selected);
      await queryClient.invalidateQueries({ queryKey: ['match-decision', matchId] });
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Offer failed — try again.');
    } finally {
      setActing(false);
    }
  }

  async function choose(factionId: string) {
    setActing(true);
    setErr(null);
    try {
      await selectFreePickFaction(matchId, factionId);
      await queryClient.invalidateQueries({ queryKey: ['match-decision', matchId] });
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Pick failed — try again.');
    } finally {
      setActing(false);
    }
  }

  return (
    <div className="flex flex-col items-center gap-6">
      <div className="text-center">
        <h2 className="font-display text-xl font-semibold text-rizzotto-gold-400 tracking-wider">Enticity&apos;s Free Pick — Mixed Matchup</h2>
        <p className="mt-1 text-sm text-rizzotto-stone-400">
          {fixedEntry ? `${fixedEntry.faction.name} (fixed) vs a faction they choose from three` : 'One player is committed, one offers three.'}
        </p>
      </div>

      {/* Pick-later player offers 3 */}
      {!revealed && viewerIsPickLater && (
        <>
          <p className="max-w-sm text-center text-sm text-rizzotto-stone-400">
            Offer 3 factions — your opponent will choose which one you play. ({selected.length}/3)
          </p>
          <div className="grid w-full grid-cols-3 gap-2 sm:grid-cols-4 lg:grid-cols-6">
            {factions.map(({ faction }) => {
              const isSel = selected.includes(faction.id);
              const banned = factionAllowlist.length > 0 && !factionAllowlist.includes(faction.id);
              const disabled = banned || (!isSel && selected.length >= 3);
              return (
                <button
                  key={faction.id}
                  type="button"
                  disabled={disabled}
                  onClick={() => toggle(faction.id)}
                  title={restrictedFactions.includes(faction.id) && !banned ? 'Restricted (nerfed) — does not count toward the leaderboard' : undefined}
                  className={[
                    'flex flex-col items-center gap-1.5 rounded-sm border p-2 text-center transition-[border-color,background-color,opacity]',
                    isSel
                      ? 'border-rizzotto-gold-500 bg-rizzotto-iron-800'
                      : disabled
                        ? 'cursor-default border-rizzotto-iron-700 bg-rizzotto-iron-900/40 opacity-40'
                        : 'border-rizzotto-iron-600 bg-rizzotto-iron-900 hover:border-rizzotto-gold-500/60',
                  ].join(' ')}
                >
                  <FactionBadge colorHex={faction.color_hex} initials={faction.initials} name={faction.name} size="lg" iconUrl={faction.icon_url} />
                  <span className={['line-clamp-2 font-display text-[10px] uppercase leading-tight tracking-wide', isSel ? 'text-rizzotto-gold-300' : 'text-rizzotto-stone-300'].join(' ')}>
                    {faction.name}
                  </span>
                </button>
              );
            })}
          </div>
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={pickRandom3}
              className="rounded-sm border border-rizzotto-iron-600 bg-rizzotto-iron-900 px-3 py-2 text-xs font-semibold text-rizzotto-stone-300 transition-colors hover:border-rizzotto-gold-500/60 hover:text-rizzotto-gold-300"
            >
              🎲 Random 3
            </button>
            <Button variant="forge" size="md" disabled={selected.length !== 3 || acting} onClick={submitOffer}>
              {acting ? 'Offering…' : 'Offer 3 Factions'}
            </Button>
          </div>
          {err && <p className="text-sm text-red-400">{err}</p>}
        </>
      )}

      {/* Fixed player waits for the offer */}
      {!revealed && !viewerIsPickLater && (
        <div className="flex flex-col items-center gap-3 text-center">
          <span className="h-8 w-8 animate-spin rounded-full border-2 border-rizzotto-gold-400 border-t-transparent" />
          <p className="text-sm text-rizzotto-stone-400">Waiting for your opponent to offer 3 factions…</p>
        </div>
      )}

      {/* Fixed player chooses one of the offered 3 */}
      {revealed && viewerIsFixed && (
        <>
          <p className="text-center text-sm text-rizzotto-stone-200">Choose the faction your opponent will field:</p>
          <div className="grid w-full max-w-lg grid-cols-3 gap-3">
            {offered.map((fid) => {
              const entry = factions.find((f) => f.faction.id === fid);
              const isH = hovered === fid;
              return (
                <button
                  key={fid}
                  type="button"
                  disabled={acting}
                  onClick={() => choose(fid)}
                  onMouseEnter={() => setHovered(fid)}
                  onMouseLeave={() => setHovered(null)}
                  className="relative flex flex-col items-center gap-2 rounded-md border border-rizzotto-iron-600 bg-rizzotto-iron-900 p-3 transition-colors hover:border-emerald-400/50"
                >
                  <FactionBadge colorHex={entry?.faction.color_hex ?? '#666'} initials={entry?.faction.initials ?? '?'} name={entry?.faction.name ?? '?'} size="lg" iconUrl={entry?.faction.icon_url} />
                  <span className="font-display text-xs uppercase tracking-wide text-rizzotto-stone-200">{entry?.faction.name ?? '?'}</span>
                  {isH && (
                    <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center rounded-md" style={{ boxShadow: 'inset 0 0 24px 6px rgba(16,185,129,0.6)' }}>
                      <span className="rounded bg-rizzotto-iron-950/70 px-2 py-0.5 font-display text-sm font-bold uppercase tracking-widest text-rizzotto-stone-100">Pick</span>
                    </div>
                  )}
                </button>
              );
            })}
          </div>
          <button
            type="button"
            disabled={acting || offered.length === 0}
            onClick={() => offered.length > 0 && void choose(offered[Math.floor(Math.random() * offered.length)]!)}
            className="rounded-sm border border-rizzotto-iron-600 bg-rizzotto-iron-900 px-3 py-2 text-xs font-semibold text-rizzotto-stone-300 transition-colors hover:border-rizzotto-gold-500/60 hover:text-rizzotto-gold-300 disabled:opacity-50"
          >
            🎲 Random
          </button>
          {err && <p className="text-sm text-red-400">{err}</p>}
        </>
      )}

      {/* Pick-later player waits for the choice */}
      {revealed && !viewerIsFixed && (
        <div className="flex flex-col items-center gap-3 text-center">
          <span className="h-8 w-8 animate-spin rounded-full border-2 border-rizzotto-gold-400 border-t-transparent" />
          <p className="text-sm text-rizzotto-stone-400">You offered 3 factions — waiting for your opponent to choose which you play…</p>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// 1v3 Phase — coin-flip roles, Picker offers 3, Runner picks 1
// ---------------------------------------------------------------------------

interface OneVThreePhaseProps {
  matchId: string;
  decision: MatchDecisionState;
  currentUserId: string;
  factions: FactionWithStatsDto[];
  rowPlayer?: PlayerRef;
  colPlayer?: PlayerRef;
  restrictedFactions?: string[];
  factionAllowlist?: string[];
}

function OneVThreePhase({ matchId, decision, currentUserId, factions, rowPlayer, colPlayer, restrictedFactions = [], factionAllowlist = [] }: OneVThreePhaseProps) {
  const queryClient = useQueryClient();
  const [selected, setSelected] = useState<string[]>([]);
  const [hovered, setHovered] = useState<string | null>(null);
  const [acting, setActing] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const mx = decision.factionMatrix;
  const setFactionId = decision.oneVThree?.setFactionId ?? null;
  const runnerId = mx?.topPlayerId ?? null;
  const pickerId = mx?.bottomPlayerId ?? null;

  const viewerIsRunner = currentUserId === runnerId;
  const viewerIsPicker = currentUserId === pickerId;

  const revealed = Boolean(mx?.revealedAt);
  const runnerIsP1 = runnerId != null && runnerId === rowPlayer?.id;
  const offered = ((revealed ? (runnerIsP1 ? mx?.p2Factions : mx?.p1Factions) : []) ?? []) as string[];

  const setFactionEntry = factions.find((f) => f.faction.id === setFactionId)?.faction;
  const runnerRef = runnerIsP1 ? rowPlayer : colPlayer;
  const pickerRef = runnerIsP1 ? colPlayer : rowPlayer;

  const toggle = (id: string) =>
    setSelected((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : prev.length >= 3 ? prev : [...prev, id]));

  const pickRandom3 = () => {
    const pool = factions
      .map((f) => f.faction.id)
      .filter((id) => id !== setFactionId && (factionAllowlist.length === 0 || factionAllowlist.includes(id)));
    for (let i = pool.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [pool[i], pool[j]] = [pool[j]!, pool[i]!];
    }
    setSelected(pool.slice(0, 3));
  };

  async function submitOffer() {
    if (selected.length !== 3) return;
    setActing(true);
    setErr(null);
    try {
      await offerOneVThreeFactions(matchId, selected);
      await queryClient.invalidateQueries({ queryKey: ['match-decision', matchId] });
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Offer failed — try again.');
    } finally {
      setActing(false);
    }
  }

  async function choose(factionId: string) {
    setActing(true);
    setErr(null);
    try {
      await selectOneVThreeFaction(matchId, factionId);
      await queryClient.invalidateQueries({ queryKey: ['match-decision', matchId] });
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Pick failed — try again.');
    } finally {
      setActing(false);
    }
  }

  return (
    <div className="flex flex-col items-center gap-6">
      <div className="text-center">
        <h2 className="font-display text-xl font-semibold text-rizzotto-gold-400 tracking-wider">1v3 — Set Faction vs. One of Three</h2>
        <p className="mt-1 text-sm text-rizzotto-stone-400">
          Coin flip:{' '}
          <span className="text-rizzotto-stone-200">{runnerRef?.id === currentUserId ? 'You' : (runnerRef?.username ?? 'The Runner')}</span>
          {' '}run{runnerRef?.id === currentUserId ? '' : 's'} {setFactionEntry?.name ?? 'the set faction'};{' '}
          <span className="text-rizzotto-stone-200">{pickerRef?.id === currentUserId ? 'You' : (pickerRef?.username ?? 'The Picker')}</span>
          {' '}bring{pickerRef?.id === currentUserId ? '' : 's'} three.
        </p>
      </div>

      {/* Picker offers 3 (the set faction is not offerable — no mirror) */}
      {!revealed && viewerIsPicker && (
        <>
          <p className="max-w-sm text-center text-sm text-rizzotto-stone-400">
            Offer 3 factions — the Runner will choose which one you play. ({selected.length}/3)
          </p>
          <div className="grid w-full grid-cols-3 gap-2 sm:grid-cols-4 lg:grid-cols-6">
            {factions.map(({ faction }) => {
              const isSel = selected.includes(faction.id);
              const isSetFaction = faction.id === setFactionId;
              const banned = factionAllowlist.length > 0 && !factionAllowlist.includes(faction.id);
              const disabled = banned || isSetFaction || (!isSel && selected.length >= 3);
              return (
                <button
                  key={faction.id}
                  type="button"
                  disabled={disabled}
                  onClick={() => toggle(faction.id)}
                  title={isSetFaction ? 'The set faction cannot be offered (no mirror)' : restrictedFactions.includes(faction.id) && !banned ? 'Restricted (nerfed) — does not count toward the leaderboard' : undefined}
                  className={[
                    'flex flex-col items-center gap-1.5 rounded-sm border p-2 text-center transition-[border-color,background-color,opacity]',
                    isSel
                      ? 'border-rizzotto-gold-500 bg-rizzotto-iron-800'
                      : disabled
                        ? 'cursor-default border-rizzotto-iron-700 bg-rizzotto-iron-900/40 opacity-40'
                        : 'border-rizzotto-iron-600 bg-rizzotto-iron-900 hover:border-rizzotto-gold-500/60',
                  ].join(' ')}
                >
                  <FactionBadge colorHex={faction.color_hex} initials={faction.initials} name={faction.name} size="lg" iconUrl={faction.icon_url} />
                  <span className={['line-clamp-2 font-display text-[10px] uppercase leading-tight tracking-wide', isSel ? 'text-rizzotto-gold-300' : 'text-rizzotto-stone-300'].join(' ')}>
                    {faction.name}
                  </span>
                </button>
              );
            })}
          </div>
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={pickRandom3}
              className="rounded-sm border border-rizzotto-iron-600 bg-rizzotto-iron-900 px-3 py-2 text-xs font-semibold text-rizzotto-stone-300 transition-colors hover:border-rizzotto-gold-500/60 hover:text-rizzotto-gold-300"
            >
              🎲 Random 3
            </button>
            <Button variant="forge" size="md" disabled={selected.length !== 3 || acting} onClick={submitOffer}>
              {acting ? 'Offering…' : 'Offer 3 Factions'}
            </Button>
          </div>
          {err && <p className="text-sm text-red-400">{err}</p>}
        </>
      )}

      {/* Runner waits for the offer */}
      {!revealed && !viewerIsPicker && (
        <div className="flex flex-col items-center gap-3 text-center">
          <span className="h-8 w-8 animate-spin rounded-full border-2 border-rizzotto-gold-400 border-t-transparent" />
          <p className="text-sm text-rizzotto-stone-400">Waiting for the Picker to offer 3 factions…</p>
        </div>
      )}

      {/* Runner chooses one of the offered 3 */}
      {revealed && viewerIsRunner && (
        <>
          <p className="text-center text-sm text-rizzotto-stone-200">Choose the faction your opponent will field (you run {setFactionEntry?.name ?? 'the set faction'}):</p>
          <div className="grid w-full max-w-lg grid-cols-3 gap-3">
            {offered.map((fid) => {
              const entry = factions.find((f) => f.faction.id === fid);
              const isH = hovered === fid;
              return (
                <button
                  key={fid}
                  type="button"
                  disabled={acting}
                  onClick={() => choose(fid)}
                  onMouseEnter={() => setHovered(fid)}
                  onMouseLeave={() => setHovered(null)}
                  className="relative flex flex-col items-center gap-2 rounded-md border border-rizzotto-iron-600 bg-rizzotto-iron-900 p-3 transition-colors hover:border-emerald-400/50"
                >
                  <FactionBadge colorHex={entry?.faction.color_hex ?? '#666'} initials={entry?.faction.initials ?? '?'} name={entry?.faction.name ?? '?'} size="lg" iconUrl={entry?.faction.icon_url} />
                  <span className="font-display text-xs uppercase tracking-wide text-rizzotto-stone-200">{entry?.faction.name ?? '?'}</span>
                  {isH && (
                    <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center rounded-md" style={{ boxShadow: 'inset 0 0 24px 6px rgba(16,185,129,0.6)' }}>
                      <span className="rounded bg-rizzotto-iron-950/70 px-2 py-0.5 font-display text-sm font-bold uppercase tracking-widest text-rizzotto-stone-100">Pick</span>
                    </div>
                  )}
                </button>
              );
            })}
          </div>
          <button
            type="button"
            disabled={acting || offered.length === 0}
            onClick={() => offered.length > 0 && void choose(offered[Math.floor(Math.random() * offered.length)]!)}
            className="rounded-sm border border-rizzotto-iron-600 bg-rizzotto-iron-900 px-3 py-2 text-xs font-semibold text-rizzotto-stone-300 transition-colors hover:border-rizzotto-gold-500/60 hover:text-rizzotto-gold-300 disabled:opacity-50"
          >
            🎲 Random
          </button>
          {err && <p className="text-sm text-red-400">{err}</p>}
        </>
      )}

      {/* Picker waits for the Runner's choice */}
      {revealed && !viewerIsRunner && (
        <div className="flex flex-col items-center gap-3 text-center">
          <span className="h-8 w-8 animate-spin rounded-full border-2 border-rizzotto-gold-400 border-t-transparent" />
          <p className="text-sm text-rizzotto-stone-400">The Runner is choosing which of the three you'll play…</p>
        </div>
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
  | 'faction_matrix'
  | 'free_pick_mini'
  | 'one_v_three'
  | 'ready';

function BlindPickCountdown({ firstLockedAt, timeoutMs }: { firstLockedAt: string | null; timeoutMs: number }) {
  const [label, setLabel] = useState<string | null>(null);

  useEffect(() => {
    if (!firstLockedAt) return;
    const deadline = new Date(new Date(firstLockedAt).getTime() + timeoutMs);

    function tick() {
      const diff = deadline.getTime() - Date.now();
      if (diff <= 0) {
        setLabel('Auto-picking now…');
        return;
      }
      const m = Math.floor(diff / 60000);
      const s = Math.floor((diff % 60000) / 1000);
      setLabel(`Auto-pick in ${m}:${s.toString().padStart(2, '0')}`);
    }

    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [firstLockedAt, timeoutMs]);

  if (!label) return null;
  return <p className="text-xs text-rizzotto-stone-500 font-mono">{label}</p>;
}

const RANDOM_MODES = new Set(['RANDOM', 'RANDOM_NO_REPEAT', 'HOST_PRESET']);
const BAN_MODES = new Set(['PICK_BAN', 'HOST_PRESET_PICK_BAN', 'RANDOM_PICK_BAN']);

/** The map sub-phase (coin flip → ban/pick or random draw). */
function mapPhase(d: MatchDecisionState): DecisionPhase {
  if (RANDOM_MODES.has(d.mode)) return 'map_random';
  if (BAN_MODES.has(d.mode)) {
    // Show coin flip briefly first if neither ban has happened
    if (d.bansTop.length === 0 && d.bansBottom.length === 0) return 'coin_flip';
    return 'map_pick_ban';
  }
  return 'coin_flip';
}

// ─── Free Pick: resolved-faction reminder shown on the map step ───
// FREE_PICK is faction-first, so both factions are already locked by the time
// players reach the map pick/ban. Surface them here so nobody has to leave the
// map screen to recall which faction they ended up fielding.
interface FreePickFactionBannerProps {
  decision: MatchDecisionState;
  factions: FactionWithStatsDto[];
  rowPlayer: PlayerRef;
  colPlayer: PlayerRef;
  currentUserId: string;
}

function FreePickFactionBanner({ decision, factions, rowPlayer, colPlayer, currentUserId }: FreePickFactionBannerProps) {
  // Mixed matchups resolve the pick-later side via the matrix; both-committed
  // matchups carry the fixed ids on freePick. Prefer the matrix, fall back to registration.
  const p1Id = decision.factionMatrix?.p1FactionId ?? decision.freePick?.p1FactionId ?? null;
  const p2Id = decision.factionMatrix?.p2FactionId ?? decision.freePick?.p2FactionId ?? null;
  const p1 = factions.find((f) => f.faction.id === p1Id)?.faction;
  const p2 = factions.find((f) => f.faction.id === p2Id)?.faction;
  if (!p1 && !p2) return null;

  return (
    <div className="mb-6 flex items-center justify-center gap-4 rounded-md border border-rizzotto-iron-700 bg-rizzotto-iron-950/50 px-5 py-3">
      {/* Player 1 (left) */}
      <div className="flex items-center gap-2">
        {p1 ? (
          <FactionBadge colorHex={p1.color_hex} initials={p1.initials} name={p1.name} size="md" iconUrl={p1.icon_url} />
        ) : (
          <span className="text-xs text-rizzotto-stone-600">TBD</span>
        )}
        <div className="flex flex-col leading-tight">
          <span className={`font-display text-sm uppercase tracking-wide ${rowPlayer?.id === currentUserId ? 'text-rizzotto-gold-300' : 'text-rizzotto-stone-200'}`}>
            {p1?.name ?? '—'}
          </span>
          <span className="text-[10px] uppercase tracking-wide text-rizzotto-stone-500">
            {rowPlayer?.id === currentUserId ? 'You' : (rowPlayer?.username ?? 'Player 1')}
          </span>
        </div>
      </div>

      <span className="font-display text-xs uppercase tracking-widest text-rizzotto-stone-600">vs</span>

      {/* Player 2 (right) */}
      <div className="flex flex-row-reverse items-center gap-2 text-right">
        {p2 ? (
          <FactionBadge colorHex={p2.color_hex} initials={p2.initials} name={p2.name} size="md" iconUrl={p2.icon_url} />
        ) : (
          <span className="text-xs text-rizzotto-stone-600">TBD</span>
        )}
        <div className="flex flex-col items-end leading-tight">
          <span className={`font-display text-sm uppercase tracking-wide ${colPlayer?.id === currentUserId ? 'text-rizzotto-gold-300' : 'text-rizzotto-stone-200'}`}>
            {p2?.name ?? '—'}
          </span>
          <span className="text-[10px] uppercase tracking-wide text-rizzotto-stone-500">
            {colPlayer?.id === currentUserId ? 'You' : (colPlayer?.username ?? 'Player 2')}
          </span>
        </div>
      </div>
    </div>
  );
}

// Per-mode match-step order: which step (faction / map) runs first. A step whose
// result is already fixed is simply skipped. Only FREE_PICK is faction-first for
// now; MATRIX stays map-first (its current behaviour) until that is confirmed.
function resolvePhase(d: MatchDecisionState | null): DecisionPhase {
  if (!d) return 'loading';

  // FREE_PICK is faction-first: the faction defines the matchup, so it is resolved
  // before the map. A committed player's faction is fixed (no step); pick-later /
  // mixed players resolve it via the matrix / mini pick first, THEN the map.
  if (d.tournamentMode === 'FREE_PICK') {
    const p1Fixed = d.freePick?.p1FactionId != null;
    const p2Fixed = d.freePick?.p2FactionId != null;
    if (!(p1Fixed && p2Fixed) && !d.factionMatrix?.decidedAt) {
      return !p1Fixed && !p2Fixed ? 'faction_matrix' : 'free_pick_mini';
    }
    return d.pickedMapId ? 'ready' : mapPhase(d);
  }

  if (d.pickedMapId) {
    // MATRIX mode: faction pick/ban after map decision
    if (d.tournamentMode === 'MATRIX') {
      if (!d.factionMatrix?.decidedAt) return 'faction_matrix';
      return 'ready';
    }
    // 1v3 mode: coin-flip roles + offer/select after map decision
    if (d.tournamentMode === 'ONE_V_THREE') {
      if (!d.factionMatrix?.decidedAt) return 'one_v_three';
      return 'ready';
    }
    // Map decided — check blind pick
    if (d.blindPick?.revealedAt) return 'ready';
    if (d.blindPick != null) return 'blind_pick';
    // blindPick is null: BPT requires a blind pick even before the first lock
    if (d.tournamentMode === 'BPT') return 'blind_pick';
    return 'ready';
  }
  return mapPhase(d);
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

  // Initial fetch — poll every 5s so the UI stays in sync even when the
  // socket room event doesn't arrive (e.g. blind-pick auto-resolve by cron).
  const { data: initialDecision, isLoading } = useQuery({
    queryKey: ['match-decision', matchId],
    queryFn: () => getMatchDecision(matchId),
    retry: false,
    refetchInterval: 5000,
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

    const handleMatrixUpdate: ServerToClientEvents['match.matrix.update'] = (payload) => {
      if (payload.matchId !== matchId) return;
      setDecision((prev) =>
        prev
          ? {
              ...prev,
              factionMatrix: {
                p1Locked: payload.p1Locked,
                p2Locked: payload.p2Locked,
                firstLockedAt: payload.firstLockedAt,
                revealedAt: payload.revealedAt,
                p1Factions: payload.p1Factions,
                p2Factions: payload.p2Factions,
                bans: payload.bans,
                pickedCell: payload.pickedCell,
                lastActionAt: payload.lastActionAt,
                decidedAt: payload.decidedAt,
                p1FactionId: payload.p1FactionId,
                p2FactionId: payload.p2FactionId,
                topPlayerId: payload.topPlayerId,
                bottomPlayerId: payload.bottomPlayerId,
              },
            }
          : prev,
      );
    };

    socket.on('match.decision.update', handleDecisionUpdate);
    socket.on('match.decision.complete', handleDecisionComplete);
    socket.on('match.blind-pick.update', handleBlindPickUpdate);
    socket.on('match.matrix.update', handleMatrixUpdate);

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
      socket.off('match.matrix.update', handleMatrixUpdate);
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
    // Poll so we notice if the match is voided/decided out from under us (#10).
    refetchInterval: 5000,
  });

  // #10 — If the opponent withdraws while the player is sitting in the picker, the
  // match is terminated out from under them (BaLi → CANCELLED/void, Swiss → a
  // forfeit-win → COMPLETED/FORFEIT). A pre-game decision screen is then meaningless,
  // so close the picker and send the player to their game tile, which shows the
  // withdrawal banner and next steps. No notification — the tile speaks for itself.
  useEffect(() => {
    const status = matchDetail?.status;
    const terminal =
      status === 'COMPLETED' ||
      status === 'CANCELLED' ||
      status === 'FORFEIT' ||
      status === 'NO_CONTEST' ||
      status === 'BYE' ||
      status === 'CATCHUP_BYE' ||
      status === 'PENDING_BYE';
    if (!terminal) return;
    if (matchDetail?.tournament_slug) {
      void router.navigate({
        to: '/tournaments/$slug',
        params: { slug: matchDetail.tournament_slug },
        hash: 'my-match',
      });
    } else {
      void router.navigate({ to: '/matches/$matchId', params: { matchId } });
    }
  }, [matchDetail?.status, matchDetail?.tournament_slug, matchId, router]);

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

  // For MATRIX: rows = match player1's factions, cols = match player2's factions
  const matrixRowPlayerId = decision?.matchPlayer1Id ?? decision?.topPlayerId;
  const matrixRowPlayer = matchDetail
    ? (matchDetail.player1?.id === matrixRowPlayerId ? matchDetail.player1 : matchDetail.player2)
    : null;
  const matrixColPlayer = matchDetail
    ? (matchDetail.player1?.id === matrixRowPlayerId ? matchDetail.player2 : matchDetail.player1)
    : null;

  const isHostOrAdmin =
    user && (user.role === 'HOST' || user.role === 'MODERATOR' || user.role === 'ADMIN');

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
    <PageShell variant={decision.tournamentMode === 'MATRIX' || decision.tournamentMode === 'FREE_PICK' ? 'wide' : 'tight'} spacing="base">
      <div className="mb-8 text-center relative">
        {matchDetail?.tournament_slug && (
          <Link
            to="/tournaments/$slug"
            params={{ slug: matchDetail.tournament_slug }}
            hash="my-match"
            className="absolute left-0 top-1 text-sm text-rizzotto-stone-500 hover:text-rizzotto-stone-300 transition-colors"
          >
            ← Back to tournament
          </Link>
        )}
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
              {(decision.tournamentMode === 'FREE_PICK' || decision.tournamentMode === 'ONE_V_THREE') && (
                <FreePickFactionBanner decision={decision} factions={factions} rowPlayer={matrixRowPlayer} colPlayer={matrixColPlayer} currentUserId={user.id} />
              )}
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
              {(decision.tournamentMode === 'FREE_PICK' || decision.tournamentMode === 'ONE_V_THREE') && (
                <FreePickFactionBanner decision={decision} factions={factions} rowPlayer={matrixRowPlayer} colPlayer={matrixColPlayer} currentUserId={user.id} />
              )}
              <PickBanPhase
                decision={decision}
                mapPool={mapPool}
                currentUserId={user.id}
                matchId={matchId}
                onDecisionUpdate={(d) => setDecision((prev) => prev ? { ...prev, ...d } : d)}
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
                pickedMapName={allTournamentMaps.find((m) => m.id === decision.pickedMapId)?.name ?? null}
                pickedMapImageUrl={allTournamentMaps.find((m) => m.id === decision.pickedMapId)?.image_url ?? null}
                restrictedFactions={decision.restrictedFactions ?? []}
                factionAllowlist={decision.factionAllowlist ?? []}
              />
            </motion.div>
          )}

          {phase === 'faction_matrix' && (
            <motion.div
              key="faction_matrix"
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.4 }}
            >
              <FactionMatrixPhase
                matchId={matchId}
                decision={decision}
                currentUserId={user.id}
                factions={factions}
                rowPlayer={matrixRowPlayer}
                colPlayer={matrixColPlayer}
                restrictedFactions={decision.restrictedFactions ?? []}
                factionAllowlist={decision.factionAllowlist ?? []}
              />
            </motion.div>
          )}

          {phase === 'free_pick_mini' && (
            <motion.div
              key="free_pick_mini"
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.4 }}
            >
              <FreePickMiniPhase
                matchId={matchId}
                decision={decision}
                currentUserId={user.id}
                factions={factions}
                rowPlayer={matrixRowPlayer}
                colPlayer={matrixColPlayer}
                restrictedFactions={decision.restrictedFactions ?? []}
                factionAllowlist={decision.factionAllowlist ?? []}
              />
            </motion.div>
          )}

          {phase === 'one_v_three' && (
            <motion.div
              key="one_v_three"
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.4 }}
            >
              <OneVThreePhase
                matchId={matchId}
                decision={decision}
                currentUserId={user.id}
                factions={factions}
                rowPlayer={matrixRowPlayer}
                colPlayer={matrixColPlayer}
                restrictedFactions={decision.restrictedFactions ?? []}
                factionAllowlist={decision.factionAllowlist ?? []}
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
              {(decision.tournamentMode === 'FREE_PICK' || decision.tournamentMode === 'ONE_V_THREE') && (
                <FreePickFactionBanner decision={decision} factions={factions} rowPlayer={matrixRowPlayer} colPlayer={matrixColPlayer} currentUserId={user.id} />
              )}
              <Button
                variant="forge"
                size="lg"
                onClick={() => {
                  if (matchDetail?.tournament_slug) {
                    void router.navigate({ to: '/tournaments/$slug', params: { slug: matchDetail.tournament_slug }, hash: 'my-match' });
                  } else {
                    void router.navigate({ to: '/matches/$matchId', params: { matchId } });
                  }
                }}
              >
                Start Match
              </Button>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Host/Admin escape hatch — force-pick a random map if a player is AFK */}
      {isHostOrAdmin && phase === 'map_pick_ban' && !decision.pickedMapId && (
        <div className="mt-4 flex justify-center">
          <button
            onClick={() => forceResolveMutation.mutate()}
            disabled={forceResolveMutation.isPending}
            className="text-xs text-rizzotto-stone-600 hover:text-rizzotto-stone-400 transition-colors disabled:opacity-50"
          >
            {forceResolveMutation.isPending ? 'Picking…' : 'Host: Pick random map'}
          </button>
        </div>
      )}
    </PageShell>
  );
}
