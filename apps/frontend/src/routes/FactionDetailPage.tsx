import { useMemo, useState } from 'react';
import { useParams, Link } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { getFaction, getMatchupHeatmap, getFactionTopPlayers, getFactionGames, getFactions, type FactionTopPlayer } from '@/lib/api';
import { FactionBadge } from '@/components/meta/FactionBadge';
import { GameHistoryTable } from '@/components/match/GameHistoryTable';
import type { FactionDto } from '@rizzotto/types';

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function StatCard({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="rounded-md border border-stone-800 bg-stone-900/60 p-4">
      <p className="text-xs text-stone-500 uppercase tracking-wide mb-1">{label}</p>
      <p className="text-2xl font-bold text-stone-100">{value}</p>
    </div>
  );
}

function WinRateBar({ rate }: { rate: number | null }) {
  const pct = rate !== null ? Math.round(rate * 100) : null;
  return (
    <div className="flex items-center gap-2 min-w-[120px]">
      <div className="h-1.5 w-20 overflow-hidden rounded-full bg-stone-800">
        {pct !== null && (
          <div
            className={`h-full rounded-full ${pct >= 50 ? 'bg-emerald-500/70' : 'bg-red-500/60'}`}
            style={{ width: `${pct}%` }}
          />
        )}
      </div>
      <span className="w-10 text-right text-xs text-stone-400">
        {pct !== null ? `${pct}%` : '—'}
      </span>
    </div>
  );
}

function SectionHeader({ title }: { title: string }) {
  return (
    <h2 className="font-display text-lg font-semibold text-rizzotto-gold-500 mb-4">{title}</h2>
  );
}

// ---------------------------------------------------------------------------
// Matchup grid
// ---------------------------------------------------------------------------

interface MatchupRow {
  factionId: string;
  wins: number;
  losses: number;
  draws: number;
  total: number;
  winRate: number | null;
  isMirror: boolean;
}

type MatchupSortCol = 'name' | 'wins' | 'losses' | 'total' | 'winRate';

function SortTh({
  label, col, sortCol, sortDir, onSort, className,
}: {
  label: string; col: MatchupSortCol; sortCol: MatchupSortCol; sortDir: 'asc' | 'desc';
  onSort: (c: MatchupSortCol) => void; className?: string;
}) {
  const active = col === sortCol;
  return (
    <button
      type="button"
      onClick={() => onSort(col)}
      className={`flex items-center gap-0.5 text-[10px] uppercase tracking-wider transition-colors ${active ? 'text-rizzotto-gold-400' : 'text-stone-500 hover:text-stone-300'} ${className ?? ''}`}
    >
      {label}
      <span className="text-[8px]">{active ? (sortDir === 'asc' ? ' ▲' : ' ▼') : ''}</span>
    </button>
  );
}

function MatchupGrid({ rows, factionMap }: { rows: MatchupRow[]; factionMap: Map<string, FactionDto> }) {
  const [sortCol, setSortCol] = useState<MatchupSortCol>('winRate');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');

  function handleSort(col: MatchupSortCol) {
    if (col === sortCol) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    else { setSortCol(col); setSortDir(col === 'name' ? 'asc' : 'desc'); }
  }

  const sorted = useMemo(() => {
    const nonMirror = rows.filter((r) => !r.isMirror);
    const mirror = rows.filter((r) => r.isMirror);
    const compare = (a: MatchupRow, b: MatchupRow): number => {
      let v = 0;
      if (sortCol === 'name') {
        const na = factionMap.get(a.factionId)?.name ?? a.factionId;
        const nb = factionMap.get(b.factionId)?.name ?? b.factionId;
        v = na.localeCompare(nb);
      } else if (sortCol === 'wins') v = a.wins - b.wins;
      else if (sortCol === 'losses') v = a.losses - b.losses;
      else if (sortCol === 'total') v = a.total - b.total;
      else v = (a.winRate ?? -1) - (b.winRate ?? -1);
      return sortDir === 'asc' ? v : -v;
    };
    return [...nonMirror.sort(compare), ...mirror];
  }, [rows, sortCol, sortDir, factionMap]);

  if (rows.length === 0) {
    return <p className="text-sm text-stone-600">No matchup data available.</p>;
  }

  return (
    <div className="space-y-0">
      <div className="flex items-center gap-2 pb-2 border-b border-stone-800">
        <SortTh label="Opponent" col="name" sortCol={sortCol} sortDir={sortDir} onSort={handleSort} className="flex-1" />
        <SortTh label="W" col="wins" sortCol={sortCol} sortDir={sortDir} onSort={handleSort} className="w-8 justify-end" />
        <SortTh label="L" col="losses" sortCol={sortCol} sortDir={sortDir} onSort={handleSort} className="w-8 justify-end" />
        <SortTh label="Total" col="total" sortCol={sortCol} sortDir={sortDir} onSort={handleSort} className="w-10 justify-end" />
        <SortTh label="Win Rate" col="winRate" sortCol={sortCol} sortDir={sortDir} onSort={handleSort} className="w-[140px] justify-end" />
      </div>
      {sorted.map((row) => {
        const faction = factionMap.get(row.factionId);
        return (
          <div
            key={row.factionId}
            className="flex items-center gap-2 border-b border-stone-800/40 py-1.5 last:border-0"
          >
            <div className="flex flex-1 items-center gap-2 min-w-0">
              {faction ? (
                <>
                  <FactionBadge size="sm" colorHex={faction.color_hex} initials={faction.initials} name={faction.name} iconUrl={faction.icon_url} />
                  <Link to="/factions/$id" params={{ id: row.factionId }} className="truncate text-xs text-stone-300 hover:text-rizzotto-gold-400 transition-colors">
                    {faction.name}
                  </Link>
                </>
              ) : (
                <span className="text-xs text-stone-500">{row.factionId}</span>
              )}
              {row.isMirror && (
                <span className="text-[9px] uppercase tracking-wider text-stone-600 border border-stone-700 rounded px-1">Mirror</span>
              )}
            </div>
            <span className="w-8 text-right text-xs text-emerald-400">{row.isMirror ? '—' : row.wins}</span>
            <span className="w-8 text-right text-xs text-red-400">{row.isMirror ? '—' : row.losses}</span>
            <span className="w-10 text-right text-xs text-stone-500">{row.isMirror ? '—' : row.total}</span>
            <div className="w-[140px] flex justify-end">
              {row.isMirror ? <span className="text-xs text-stone-600">—</span> : <WinRateBar rate={row.winRate} />}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Top Players
// ---------------------------------------------------------------------------

function TopPlayerRow({ player }: { player: FactionTopPlayer }) {
  const wr = player.winRate !== null ? Math.round(player.winRate * 100) : null;
  return (
    <Link
      to="/users/$id"
      params={{ id: player.userId }}
      className="flex items-center gap-3 rounded py-1.5 px-1 hover:bg-stone-800/40 transition-colors"
    >
      {player.avatarUrl ? (
        <img src={player.avatarUrl} alt="" className="h-6 w-6 rounded-full border border-stone-700 object-cover shrink-0" />
      ) : (
        <span className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-stone-700 text-[10px] text-stone-300">
          {player.username[0]?.toUpperCase() ?? '?'}
        </span>
      )}
      <span className="flex-1 truncate text-sm text-stone-200">{player.username}</span>
      <span className="w-10 text-right text-xs text-stone-500">{player.games}</span>
      <span className={`w-12 text-right text-xs font-medium ${wr !== null && wr >= 50 ? 'text-emerald-400' : 'text-red-400'}`}>
        {wr !== null ? `${wr}%` : '—'}
      </span>
    </Link>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export function FactionDetailPage() {
  const { id } = useParams({ from: '/factions/$id' });

  const { data, isLoading, error } = useQuery({
    queryKey: ['faction', id],
    queryFn: () => getFaction(id),
  });

  const { data: matchupData } = useQuery({
    queryKey: ['meta-matchups'],
    queryFn: () => getMatchupHeatmap(),
    staleTime: 2 * 60 * 1000,
  });

  const { data: topPlayersData } = useQuery({
    queryKey: ['faction-top-players', id],
    queryFn: () => getFactionTopPlayers(id),
  });

  const { data: gamesData } = useQuery({
    queryKey: ['faction-games', id],
    queryFn: () => getFactionGames(id),
  });

  const { data: factionsData } = useQuery({
    queryKey: ['factions'],
    queryFn: () => getFactions(),
    staleTime: 5 * 60 * 1000,
  });

  const factionMap = useMemo<Map<string, FactionDto>>(
    () => new Map((factionsData?.data ?? []).map((fw) => [fw.faction.id, fw.faction])),
    [factionsData],
  );

  // Build matchup rows for this faction vs all others
  const matchupRows = useMemo<MatchupRow[]>(() => {
    const cells = matchupData?.cells ?? [];
    const allFactions = factionsData?.data ?? [];

    const rowMap = new Map<string, MatchupRow>();

    for (const cell of cells) {
      if (cell.faction_a_id === id) {
        const opponentId = cell.faction_b_id;
        rowMap.set(opponentId, {
          factionId: opponentId,
          wins: cell.faction_a_wins,
          losses: cell.faction_b_wins,
          draws: cell.draws,
          total: cell.total,
          winRate: cell.winrate_a,
          isMirror: opponentId === id,
        });
      } else if (cell.faction_b_id === id) {
        const opponentId = cell.faction_a_id;
        if (!rowMap.has(opponentId)) {
          rowMap.set(opponentId, {
            factionId: opponentId,
            wins: cell.faction_b_wins,
            losses: cell.faction_a_wins,
            draws: cell.draws,
            total: cell.total,
            winRate: cell.winrate_a !== null ? 1 - cell.winrate_a : null,
            isMirror: false,
          });
        }
      }
    }

    // Ensure all factions appear (0-game entries for those not in the matrix)
    for (const fw of allFactions) {
      const fId = fw.faction.id;
      if (!rowMap.has(fId)) {
        rowMap.set(fId, { factionId: fId, wins: 0, losses: 0, draws: 0, total: 0, winRate: null, isMirror: fId === id });
      }
    }

    return [...rowMap.values()].sort((a, b) => {
      if (a.isMirror && !b.isMirror) return 1;
      if (!a.isMirror && b.isMirror) return -1;
      return b.total - a.total;
    });
  }, [matchupData, factionsData, id]);

  if (isLoading) {
    return (
      <main className="mx-auto max-w-5xl px-4 py-10">
        <div className="py-8 text-center text-stone-400 text-sm">Loading…</div>
      </main>
    );
  }

  if (error || !data) {
    return (
      <main className="mx-auto max-w-5xl px-4 py-10">
        <div className="rounded-md border border-red-900 bg-red-950/40 p-4 text-red-300 text-sm">
          Failed to load faction.
        </div>
      </main>
    );
  }

  const { faction, stats } = data;

  return (
    <main className="mx-auto max-w-5xl px-4 py-10 space-y-8">
      {/* Header */}
      <div className="flex items-center gap-5">
        <FactionBadge
          colorHex={faction.color_hex}
          initials={faction.initials}
          name={faction.name}
          size="lg"
          iconUrl={faction.icon_url}
        />
        <h1 className="font-display text-3xl font-bold text-rizzotto-gold-500">{faction.name}</h1>
      </div>

      {/* Stat Cards */}
      {stats ? (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-5">
          <StatCard label="Games" value={stats.matches_played} />
          <StatCard label="Wins" value={<span className="text-emerald-400">{stats.wins}</span>} />
          <StatCard label="Losses" value={<span className="text-red-400">{stats.losses}</span>} />
          <StatCard label="Draws" value={stats.draws} />
          <StatCard
            label="Win Rate"
            value={
              stats.win_rate !== null ? (
                <span className={stats.win_rate >= 0.5 ? 'text-emerald-400' : 'text-red-400'}>
                  {Math.round(stats.win_rate * 100)}%
                </span>
              ) : '—'
            }
          />
        </div>
      ) : (
        <div className="rounded-md border border-stone-800 bg-stone-900/40 p-4 text-stone-500 text-sm">
          No statistics available for this faction yet.
        </div>
      )}

      {/* Two-column layout: Matchups + Top Players */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_280px]">
        {/* Matchup grid */}
        <section className="rounded-md border border-stone-800 bg-stone-900/40 p-5">
          <SectionHeader title="Matchup Win Rates" />
          <MatchupGrid rows={matchupRows} factionMap={factionMap} />
        </section>

        {/* Top Players */}
        <section className="rounded-md border border-stone-800 bg-stone-900/40 p-5">
          <SectionHeader title="Top Players" />
          {(topPlayersData?.players.length ?? 0) === 0 ? (
            <p className="text-sm text-stone-600">No players with 3+ games yet.</p>
          ) : (
            <>
              <div className="flex items-center gap-3 pb-1.5 text-[10px] uppercase tracking-wider text-stone-500 border-b border-stone-800 mb-1">
                <span className="flex-1">Player</span>
                <span className="w-10 text-right">Games</span>
                <span className="w-12 text-right">WR</span>
              </div>
              <div className="space-y-0.5">
                {(topPlayersData?.players ?? []).map((p) => (
                  <TopPlayerRow key={p.userId} player={p} />
                ))}
              </div>
            </>
          )}
        </section>
      </div>

      {/* All Games */}
      <section className="rounded-md border border-stone-800 bg-stone-900/40 p-5">
        <SectionHeader title="Recent Games" />
        {(gamesData?.games.length ?? 0) === 0 ? (
          <p className="text-sm text-stone-600">No games recorded for this faction yet.</p>
        ) : (
          <GameHistoryTable games={gamesData?.games ?? []} showTournament />
        )}
      </section>
    </main>
  );
}
