import { Fragment, useState } from 'react';
import { Link } from '@tanstack/react-router';
import { useQueryClient, useMutation } from '@tanstack/react-query';
import type { FactionDto, SwissMeta, SwissStandingEntry } from '@rizzotto/types';
import { FactionBadge } from '@/components/meta/FactionBadge';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { dropParticipant, undropParticipant, adminCheckIn, setParticipantFaction, type ParticipantStatus } from '@/lib/api';
import { SKILL_BAND_META } from './skillBandMeta.js';

const PLACEMENT_BADGE: Record<1 | 2 | 3, { label: string; className: string }> = {
  1: { label: '1ST', className: 'text-rizzotto-gold-400 border-rizzotto-gold-500/50 bg-rizzotto-gold-500/10' },
  2: { label: '2ND', className: 'text-stone-300 border-stone-500/40 bg-stone-700/20' },
  3: { label: '3RD', className: 'text-orange-500 border-orange-700/40 bg-orange-950/30' },
};

interface SwissStandingsProps {
  standings: SwissMeta['standings'];
  currentRound: number;
  recommendedRounds: number;
  factionMap?: Map<string, FactionDto>;
  /** userId → factionId, derived from bracket matches as fallback */
  playerFactionMap?: Map<string, string>;
  /** userId → 3-faction pool, for TWO_D_THREE (shows all 3 picked factions) */
  playerFactionPoolMap?: Map<string, string[]>;
  /** Tournament mode — Faction column shown only for SFT (and future 2FT/3FT) */
  tournamentMode?: string;
  /** Playoff format — controls first-divider position */
  playoffFormat?: 'NONE' | 'TOP2' | 'TOP4' | 'TOP8' | null;
  /** Players who have advanced to the Grand Final (from PLAYOFF_FINAL match) */
  finalistIds?: ReadonlySet<string>;
  /** Division champions — the winner of each PLAYOFF_FINAL (shown as "Champion", not "Finalist"). */
  championIds?: ReadonlySet<string>;
  /** Balanced Liechtenstein: tournament podium (top division's playoff) — userId →
   *  1|2|3. When set, drives the placement badge instead of the group rank. */
  podium?: ReadonlyMap<string, 1 | 2 | 3>;
  /** Balanced Liechtenstein: userId → the band of the division whose FINAL they reached.
   *  Tints the finalist banner to that division's colour (shows a borrowed play-up). */
  finalDivisionBandByUser?: ReadonlyMap<string, number>;
  /** Players who have qualified for the Semifinals (QF winners — TOP8 only) */
  semifinalistIds?: Set<string>;
  /** Tournament slug — enables drop/undrop buttons when set */
  tournamentSlug?: string;
  /** Whether the current user can manage the tournament */
  canManage?: boolean;
  /** Only show placement badges (1ST/2ND/3RD) once the tournament is fully completed */
  isCompleted?: boolean;
  /** userId → ParticipantStatus — enables Force-Check-in button for REGISTERED, Withdrew badge for WITHDREW */
  participantStatusMap?: Map<string, ParticipantStatus>;
  /** Faction IDs in the allowlist (empty = all factions allowed) */
  factionAllowlist?: string[];
}

function Avatar({ url, username }: { url: string | null; username: string }) {
  if (!url) {
    return (
      <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-stone-700 text-xs font-medium text-stone-200">
        {username[0]?.toUpperCase() ?? '?'}
      </span>
    );
  }
  return (
    <img
      src={url}
      alt={username}
      className="h-6 w-6 rounded-full border border-stone-700 object-cover"
    />
  );
}

const FACTION_MODES = new Set(['SFT', '2FT', 'DFT', '3FT', 'TFT', 'TWO_D_THREE', 'FREE_PICK', 'ONE_V_THREE']);

function Divider({ label, colSpan }: { label: string; colSpan: number }) {
  return (
    <tr>
      <td
        colSpan={colSpan}
        className="px-4 py-1.5 bg-rizzotto-gold-500/5 border-y border-rizzotto-gold-500/20"
      >
        <span className="text-[10px] text-rizzotto-gold-500/70 uppercase tracking-widest font-semibold">
          ↑ {label}
        </span>
      </td>
    </tr>
  );
}

export function SwissStandings({
  standings,
  currentRound,
  recommendedRounds,
  factionMap,
  playerFactionMap,
  playerFactionPoolMap,
  tournamentMode,
  playoffFormat,
  finalistIds,
  championIds,
  podium,
  finalDivisionBandByUser,
  semifinalistIds,
  tournamentSlug,
  canManage = false,
  isCompleted = false,
  participantStatusMap,
  factionAllowlist,
}: SwissStandingsProps) {
  const queryClient = useQueryClient();
  const [factionPickTarget, setFactionPickTarget] = useState<string | null>(null);
  const dropMutation = useMutation({
    mutationFn: (userId: string) => dropParticipant(tournamentSlug!, userId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['bracket'] });
      void queryClient.invalidateQueries({ queryKey: ['tournament-participants'] });
    },
  });
  const undropMutation = useMutation({
    mutationFn: (userId: string) => undropParticipant(tournamentSlug!, userId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['bracket'] });
      void queryClient.invalidateQueries({ queryKey: ['tournament-participants'] });
    },
    onError: (err: Error) => {
      alert(`Undrop failed: ${err.message}`);
    },
  });
  const forceCheckInMutation = useMutation({
    mutationFn: (userId: string) => adminCheckIn(tournamentSlug!, userId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['bracket'] });
      void queryClient.invalidateQueries({ queryKey: ['tournament-participants'] });
    },
    onError: (err: Error) => {
      alert(`Force check-in failed: ${err.message}`);
    },
  });
  const setFactionMutation = useMutation({
    mutationFn: ({ userId, factionId }: { userId: string; factionId: string | null }) =>
      setParticipantFaction(tournamentSlug!, userId, factionId),
    onSuccess: () => {
      setFactionPickTarget(null);
      void queryClient.invalidateQueries({ queryKey: ['bracket'] });
      void queryClient.invalidateQueries({ queryKey: ['tournament-participants'] });
    },
    onError: (err: Error) => {
      alert(`Failed to set faction: ${err.message}`);
    },
  });

  const pickerFactions = factionMap
    ? [...factionMap.values()].filter(
        (f) => !factionAllowlist?.length || factionAllowlist.includes(f.id),
      ).sort((a, b) => a.name.localeCompare(b.name))
    : [];

  const showFactionColumn = tournamentMode ? FACTION_MODES.has(tournamentMode) : false;
  const is2D3 = tournamentMode === 'TWO_D_THREE';
  const isFreePick = tournamentMode === 'FREE_PICK';
  const colCount = 5 + (showFactionColumn ? 1 : 0) + 1; // # + Player + [Faction] + Score + W/D/L/B + GL + BH

  // Cap displayed round at the Swiss phase — don't count playoff rounds.
  const displayRound = Math.min(currentRound, recommendedRounds);

  // Divider thresholds — three possible dividers rendered from bottom to top:
  //   1. "Advance to Quarterfinals" (TOP8 only, before any QF is played)
  //   2. "Advance to Semifinals"   (TOP8: after QF winners known; TOP4: on playoff start)
  //   3. "Advance to Grand Final"  (after SF winners known)
  const playoffCutoff = playoffFormat === 'TOP8' ? 8 : playoffFormat === 'TOP4' ? 4 : playoffFormat === 'TOP2' ? 2 : 0;
  const playoffsStarted = playoffCutoff > 0 && currentRound >= recommendedRounds;

  const isTop8 = playoffFormat === 'TOP8';
  const sfCount = semifinalistIds?.size ?? 0;

  // QF divider: TOP8 only, shown until the first QF winner is known
  const showQFDivider = isTop8 && playoffsStarted && sfCount === 0;

  // SF divider:
  //   TOP4 — shown once playoffs start (until SF winners emerge)
  //   TOP8 — shown once ≥1 QF winner is known, dynamically tracks confirmed count
  const showSFDivider = playoffsStarted && !isTop8
    ? (finalistIds?.size ?? 0) === 0          // TOP4: until first SF winner
    : isTop8 && sfCount > 0;                  // TOP8: as QF winners emerge
  const sfDividerAfterRank = isTop8 ? sfCount : playoffCutoff;

  // GF divider: once ≥1 SF winner is known
  const showFinalsDivider = (finalistIds?.size ?? 0) > 0;
  const finalsDividerAfterRank = finalistIds?.size ?? 2;

  // Balanced Liechtenstein: group standings into per-band tables when skillBand is set.
  const isBalanced = standings.some((e) => e.skillBand != null);

  // ---------------------------------------------------------------------------
  // Shared row renderer — used for both the flat table and per-division tables.
  // `rankOffset` lets division tables continue the global rank numbering.
  // ---------------------------------------------------------------------------
  function renderRows(entries: SwissStandingEntry[], rankOffset = 0) {
    return entries.map((entry, idx) => {
      const rank = idx + 1 + rankOffset;
      const displayName = entry.username ?? entry.userId;
      // In FREE_PICK mode a null faction means "pick-later" (intentional), so don't
      // fill it from the per-game bracket fallback — that would overwrite "Free Pick"
      // with whatever faction the player happened to pick first. Match nodes still
      // show each game's actual picked faction.
      const factionId = isFreePick ? entry.factionId : (entry.factionId ?? playerFactionMap?.get(entry.userId));
      const faction = factionId ? factionMap?.get(factionId) : undefined;
      const factionPool = is2D3 ? (playerFactionPoolMap?.get(entry.userId) ?? []) : [];
      const isFinalist = finalistIds?.has(entry.userId);
      const isChampion = championIds?.has(entry.userId);
      const participantStatus = participantStatusMap?.get(entry.userId);
      const isDropped = entry.dropped === true || participantStatus === 'WITHDREW';
      // Only flag as "never checked in" if REGISTERED AND has no match history.
      // REGISTERED players who are actively playing (no check-in required tournament)
      // must NOT show the Force Check-in button.
      const hasNoMatchHistory = entry.wins === 0 && entry.losses === 0 && entry.draws === 0 && entry.byes === 0;
      const isNeverCheckedIn = participantStatus === 'REGISTERED' && hasNoMatchHistory;

      // Placement badge. Balanced Liechtenstein: the whole tournament's 1st/2nd/3rd
      // come from the TOP division's playoff result (`podium`, keyed by userId) — so a
      // borrowed player who won the small final gets 3RD even though they are listed
      // under a lower division, and the group-rank-3 player who LOST it gets nothing.
      // Every other format keeps the group-rank badge (top 3 of the final standings).
      const placementKey: 1 | 2 | 3 | undefined =
        !isCompleted || isDropped
          ? undefined
          : podium
            ? podium.get(entry.userId)
            : rank <= 3
              ? (rank as 1 | 2 | 3)
              : undefined;
      const badge = placementKey ? PLACEMENT_BADGE[placementKey] : null;

      const skillBandMeta = entry.skillBand != null ? SKILL_BAND_META[entry.skillBand] : null;

      return (
        <Fragment key={entry.userId}>
          {/* GF / SF / QF dividers — only relevant in the flat (non-balanced) table */}
          {!isBalanced && showFinalsDivider && rank === finalsDividerAfterRank + 1 && (
            <Divider label="Advance to Grand Final" colSpan={colCount} />
          )}
          {!isBalanced && showSFDivider && rank === sfDividerAfterRank + 1 && (
            <Divider label="Advance to Semifinals" colSpan={colCount} />
          )}
          {!isBalanced && showQFDivider && rank === playoffCutoff + 1 && (
            <Divider label="Advance to Quarterfinals" colSpan={colCount} />
          )}
          <tr
            className={`hover:bg-stone-800/30 transition-colors ${isFinalist ? 'bg-rizzotto-gold-500/5' : ''} ${isDropped || isNeverCheckedIn ? 'opacity-50' : ''}`}
          >
            <td className="px-4 py-2 text-stone-500">{rank}</td>
            <td className="px-4 py-2">
              <Link
                to="/users/$id"
                params={{ id: entry.userId }}
                className="flex items-center gap-2 hover:text-rizzotto-gold-500 transition-colors"
              >
                <Avatar url={entry.avatarUrl} username={displayName} />
                <span className={`${isDropped ? 'line-through text-stone-500' : 'text-stone-200'}`}>
                  {displayName}
                </span>
                {badge && (
                  <span className={`ml-0.5 rounded border px-1.5 py-px text-[10px] font-bold uppercase tracking-wider ${badge.className}`}>
                    {badge.label}
                  </span>
                )}
                {/* Division champion / finalist badge (BALANCED_LIECHTENSTEIN Division Finals).
                    Tinted to the division whose FINAL this player reached — so a borrowed
                    player who played UP shows the colour of the division they reached, not
                    their home band. Falls back to gold when the final's band is unknown. */}
                {isFinalist && (() => {
                  const finalBand = finalDivisionBandByUser?.get(entry.userId);
                  const finalMeta = finalBand != null ? SKILL_BAND_META[finalBand] : null;
                  const cls = finalMeta
                    ? `${finalMeta.textCls} ${finalMeta.borderCls} ${finalMeta.bgCls}`
                    : `text-rizzotto-gold-400 border-rizzotto-gold-500/50 ${isChampion ? 'bg-rizzotto-gold-500/20' : 'bg-rizzotto-gold-500/10'}`;
                  return (
                    <span
                      className={`ml-0.5 rounded border px-1.5 py-px text-[10px] font-bold uppercase tracking-wider ${cls} ${isChampion ? 'ring-1 ring-inset ring-current/30' : ''}`}
                      title={`${finalMeta ? `${finalMeta.name} Division ` : ''}${isChampion ? 'Champion' : 'Finalist'}`}
                    >
                      {isChampion ? '🏆 Champion' : '★ Finalist'}
                    </span>
                  );
                })()}
                {/* Band badge — shown in non-balanced mode only (in balanced, the section header carries the band) */}
                {skillBandMeta && !isBalanced && (
                  <span
                    className={`ml-0.5 rounded border px-1.5 py-px text-[10px] font-semibold uppercase tracking-wider ${skillBandMeta.textCls} ${skillBandMeta.borderCls} ${skillBandMeta.bgCls}`}
                    title={`Skill band: ${skillBandMeta.name}`}
                  >
                    {skillBandMeta.name}
                  </span>
                )}
                {isDropped && (
                  <span className="text-[10px] text-amber-600/80 uppercase tracking-wider font-semibold">Withdrew</span>
                )}
              </Link>
              {canManage && tournamentSlug && !isDropped && (
                <button
                  type="button"
                  disabled={dropMutation.isPending}
                  onClick={(e) => {
                    e.stopPropagation();
                    if (confirm(`Drop ${displayName} from the tournament?`)) dropMutation.mutate(entry.userId);
                  }}
                  className="ml-1 rounded border border-red-900/60 px-1.5 py-px text-[10px] text-red-500/70 hover:border-red-700 hover:text-red-400 transition-colors disabled:opacity-40 shrink-0"
                >
                  Drop
                </button>
              )}
              {canManage && tournamentSlug && isDropped && !isNeverCheckedIn && (
                <button
                  type="button"
                  disabled={undropMutation.isPending}
                  onClick={(e) => {
                    e.stopPropagation();
                    if (confirm(`Undrop ${displayName}? FORFEIT matches are NOT auto-restored.`)) undropMutation.mutate(entry.userId);
                  }}
                  className="ml-1 rounded border border-emerald-900/60 px-1.5 py-px text-[10px] text-emerald-500/70 hover:border-emerald-700 hover:text-emerald-400 transition-colors disabled:opacity-40 shrink-0"
                >
                  Undrop
                </button>
              )}
              {canManage && tournamentSlug && isNeverCheckedIn && (
                <button
                  type="button"
                  disabled={forceCheckInMutation.isPending}
                  onClick={(e) => {
                    e.stopPropagation();
                    if (confirm(`Force check-in ${displayName}?`)) forceCheckInMutation.mutate(entry.userId);
                  }}
                  className="ml-1 rounded border border-rizzotto-gold-700/60 px-1.5 py-px text-[10px] text-rizzotto-gold-400/70 hover:border-rizzotto-gold-500 hover:text-rizzotto-gold-400 transition-colors disabled:opacity-40 shrink-0"
                >
                  Force Check-in
                </button>
              )}
            </td>
            {showFactionColumn && is2D3 && (
              <td className="px-4 py-2">
                {factionPool.length > 0 ? (
                  <div className="flex items-center gap-1">
                    {factionPool.map((fid) => {
                      const f = factionMap?.get(fid);
                      return f ? (
                        <Link key={fid} to="/factions/$id" params={{ id: fid }} className="inline-flex shrink-0 hover:opacity-80 transition-opacity">
                          <FactionBadge
                            size="sm"
                            colorHex={f.color_hex}
                            initials={f.initials}
                            name={f.name}
                            iconUrl={f.icon_url}
                          />
                        </Link>
                      ) : null;
                    })}
                  </div>
                ) : (
                  <span className="text-xs text-stone-600">—</span>
                )}
              </td>
            )}
            {showFactionColumn && !is2D3 && (
              <td className="px-4 py-2">
                <div className="flex items-center gap-2">
                  {faction && factionId ? (
                    <Link to="/factions/$id" params={{ id: factionId }} className="flex items-center gap-2 hover:opacity-80 transition-opacity">
                      <FactionBadge
                        size="sm"
                        colorHex={faction.color_hex}
                        initials={faction.initials}
                        name={faction.name}
                        iconUrl={faction.icon_url}
                      />
                      <span className="text-xs text-stone-300 hover:text-rizzotto-gold-400 transition-colors">{faction.name}</span>
                    </Link>
                  ) : isFreePick ? (
                    <span className="rounded border border-rizzotto-iron-600 px-2 py-0.5 text-[10px] uppercase tracking-wide text-rizzotto-stone-500">Free Pick</span>
                  ) : (
                    <span className="text-xs text-stone-600">—</span>
                  )}
                  {/* Host inline faction edit — same affordance as the Drop/Undrop buttons (#29) */}
                  {canManage && tournamentSlug && !isDropped && (
                    <button
                      type="button"
                      onClick={() => setFactionPickTarget(entry.userId)}
                      title="Change this player's faction (host)"
                      className="rounded border border-dashed border-stone-600 px-1.5 py-px text-[10px] text-stone-500 hover:border-rizzotto-gold-500/60 hover:text-rizzotto-gold-400 transition-colors shrink-0"
                    >
                      {faction ? 'Edit' : 'Set'}
                    </button>
                  )}
                </div>
              </td>
            )}
            <td className="px-4 py-2 text-right font-semibold text-stone-100">
              {entry.score}
            </td>
            <td className="px-4 py-2 text-center text-stone-300">
              <span className="text-emerald-400">{entry.wins}</span>
              <span className="text-stone-600"> / </span>
              <span className="text-amber-400">{entry.draws}</span>
              <span className="text-stone-600"> / </span>
              <span className="text-red-400">{entry.losses}</span>
              <span className="text-stone-600"> / </span>
              <span className="text-stone-400">{entry.byes}</span>
            </td>
            <td className="px-4 py-2 text-right text-stone-400 tabular-nums">{entry.gamesLost}</td>
            <td className="px-4 py-2 text-right text-stone-500 tabular-nums text-xs">{entry.buchholz.toFixed(1)}</td>
          </tr>
        </Fragment>
      );
    });
  }

  // ---------------------------------------------------------------------------
  // Shared table chrome (thead + optional tbody wrapper)
  // ---------------------------------------------------------------------------
  function TableHead() {
    return (
      <thead>
        <tr className="border-b border-stone-800">
          <th className="px-4 py-2 text-left font-medium text-stone-400">#</th>
          <th className="px-4 py-2 text-left font-medium text-stone-400">Player</th>
          {showFactionColumn && <th className="px-4 py-2 text-left font-medium text-stone-400">Faction</th>}
          <th className="px-4 py-2 text-right font-medium text-stone-400">Score</th>
          <th className="px-4 py-2 text-center font-medium text-stone-400" title="Wins / Draws / Losses / Byes">W / D / L / B</th>
          <th className="px-4 py-2 text-right font-medium text-stone-400 tabular-nums" title="Games Lost">GL</th>
          <th className="px-4 py-2 text-right font-medium text-stone-400 tabular-nums" title="Buchholz">BH</th>
        </tr>
      </thead>
    );
  }

  // ---------------------------------------------------------------------------
  // BALANCED_LIECHTENSTEIN: group by skillBand, highest band first.
  // ---------------------------------------------------------------------------
  if (isBalanced) {
    // Collect distinct band numbers descending.
    const bandNumbers = [...new Set(standings.map((e) => e.skillBand ?? 0))].sort((a, b) => b - a);
    // Group entries per band, preserving original sort order within each band.
    const byBand = new Map<number, SwissStandingEntry[]>();
    for (const e of standings) {
      const b = e.skillBand ?? 0;
      const arr = byBand.get(b) ?? [];
      arr.push(e);
      byBand.set(b, arr);
    }
    // Running offset so the rank column reflects the overall position across bands.
    let offset = 0;

    return (
      <div className="mb-6 rounded-md border border-stone-800 bg-stone-900/40 overflow-hidden">
        <div className="px-4 py-3 border-b border-stone-800 bg-stone-900/60">
          <h3 className="font-display text-base font-semibold text-rizzotto-gold-500">
            Standings (Round {displayRound}/{recommendedRounds})
          </h3>
        </div>
        {/* One shared table so every division's columns line up identically — the
            band divisions are full-width section-header rows, not separate tables. */}
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <TableHead />
            <tbody className="divide-y divide-stone-800/60">
              {bandNumbers.map((band) => {
                const meta = SKILL_BAND_META[band];
                const entries = byBand.get(band) ?? [];
                const currentOffset = offset;
                offset += entries.length;
                return (
                  <Fragment key={band}>
                    <tr>
                      <td
                        colSpan={colCount}
                        className={`px-4 py-2 border-y border-stone-800 ${meta?.bgCls ?? 'bg-stone-800/20'}`}
                      >
                        <div className="flex items-center gap-2">
                          <span className={`h-2 w-2 rounded-full shrink-0 ${meta?.dotCls ?? 'bg-stone-500'}`} />
                          <span className={`text-xs font-bold uppercase tracking-widest ${meta?.textCls ?? 'text-stone-400'}`}>
                            {meta?.name ?? `Band ${band}`} Division
                          </span>
                        </div>
                      </td>
                    </tr>
                    {renderRows(entries, currentOffset)}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
        <Dialog open={factionPickTarget !== null} onOpenChange={(open) => { if (!open) setFactionPickTarget(null); }}>
          <DialogContent className="max-w-lg">
            <DialogHeader>
              <DialogTitle>Set Faction</DialogTitle>
            </DialogHeader>
            <div className="grid grid-cols-3 gap-2 pt-2">
              {isFreePick && (
                <button
                  type="button"
                  disabled={setFactionMutation.isPending}
                  onClick={() => {
                    if (factionPickTarget) setFactionMutation.mutate({ userId: factionPickTarget, factionId: null });
                  }}
                  className="col-span-3 rounded border border-dashed border-stone-600 px-2 py-1.5 text-xs text-stone-400 hover:border-rizzotto-gold-500/60 hover:text-rizzotto-gold-400 transition-colors disabled:opacity-40"
                >
                  — Free Pick (pick-later) —
                </button>
              )}
              {pickerFactions.map((f) => (
                <button
                  key={f.id}
                  type="button"
                  disabled={setFactionMutation.isPending}
                  onClick={() => {
                    if (factionPickTarget) setFactionMutation.mutate({ userId: factionPickTarget, factionId: f.id });
                  }}
                  className="flex items-center gap-2 rounded border border-stone-700 px-2 py-1.5 text-xs text-stone-300 hover:border-rizzotto-gold-500/60 hover:text-rizzotto-gold-400 transition-colors disabled:opacity-40"
                >
                  <FactionBadge size="sm" colorHex={f.color_hex} initials={f.initials} name={f.name} iconUrl={f.icon_url} />
                  <span className="truncate">{f.name}</span>
                </button>
              ))}
            </div>
          </DialogContent>
        </Dialog>
      </div>
    );
  }

  // ---------------------------------------------------------------------------
  // Standard (non-Balanced) flat table — unchanged original layout.
  // ---------------------------------------------------------------------------
  return (
    <div className="mb-6 rounded-md border border-stone-800 bg-stone-900/40 overflow-hidden">
      <div className="px-4 py-3 border-b border-stone-800 bg-stone-900/60">
        <h3 className="font-display text-base font-semibold text-rizzotto-gold-500">
          Standings (Round {displayRound}/{recommendedRounds})
        </h3>
      </div>
      <div className="overflow-x-auto">
        <table className="min-w-full text-sm">
          <TableHead />
          <tbody className="divide-y divide-stone-800/60">
            {renderRows(standings)}
          </tbody>
        </table>
      </div>
      <Dialog open={factionPickTarget !== null} onOpenChange={(open) => { if (!open) setFactionPickTarget(null); }}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Set Faction</DialogTitle>
          </DialogHeader>
          <div className="grid grid-cols-3 gap-2 pt-2">
            {isFreePick && (
              <button
                type="button"
                disabled={setFactionMutation.isPending}
                onClick={() => {
                  if (factionPickTarget) setFactionMutation.mutate({ userId: factionPickTarget, factionId: null });
                }}
                className="col-span-3 rounded border border-dashed border-stone-600 px-2 py-1.5 text-xs text-stone-400 hover:border-rizzotto-gold-500/60 hover:text-rizzotto-gold-400 transition-colors disabled:opacity-40"
              >
                — Free Pick (pick-later) —
              </button>
            )}
            {pickerFactions.map((f) => (
              <button
                key={f.id}
                type="button"
                disabled={setFactionMutation.isPending}
                onClick={() => {
                  if (factionPickTarget) setFactionMutation.mutate({ userId: factionPickTarget, factionId: f.id });
                }}
                className="flex items-center gap-2 rounded border border-stone-700 px-2 py-1.5 text-xs text-stone-300 hover:border-rizzotto-gold-500/60 hover:text-rizzotto-gold-400 transition-colors disabled:opacity-40"
              >
                <FactionBadge size="sm" colorHex={f.color_hex} initials={f.initials} name={f.name} iconUrl={f.icon_url} />
                <span className="truncate">{f.name}</span>
              </button>
            ))}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
