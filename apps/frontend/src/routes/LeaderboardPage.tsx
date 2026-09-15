import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import {
  getMajorWinsLeaderboard,
  getQuarterlyLeaderboard,
  getLadderLeaderboard,
  getRankings,
  getQuarterlyChampionships,
  getLadderChampionship,
  seedChampionship,
  type LeaderboardBattleType,
  type LeaderboardFormat,
  type LeaderboardPeriod,
  type RankingsEntry,
  type QuarterlyEntry,
  type TeamRef,
  type ChampionshipTile,
} from '@/lib/api.js';
import { Select } from '@/components/ui/select.js';
import { PageShell } from '@/components/layout/PageShell.js';
import { EmptyState } from '@/components/ui/empty-state.js';
import { SupporterBadge } from '@/components/supporter/SupporterBadge.js';
import { useMajorsEnabled } from '@/hooks/useFeatureFlags.js';
import { useAuthQuery } from '@/lib/auth.js';

type Tab = 'rankings' | 'quarterly' | 'ladder' | 'champions';

const PAGE_SIZE = 1000;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function normalize(s: string): string {
  return s.trim().toLowerCase();
}

/** Win% vs the average active player, from a general-skill log-odds value. */
function winPct(gs: number): number {
  return Math.round((1 / (1 + Math.exp(-gs))) * 100);
}

const TABLE_WRAP =
  'overflow-x-auto rounded-md border border-rizzotto-iron-700/70 bg-rizzotto-iron-900/50 bg-stone-wall-texture bg-[length:512px_512px] bg-blend-soft-light backdrop-blur-sm';
const THEAD_ROW = 'border-b border-rizzotto-iron-800/80 bg-rizzotto-iron-900/60';

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function LeaderboardSearch({
  value,
  onChange,
  count,
}: {
  value: string;
  onChange: (v: string) => void;
  count: number;
}) {
  return (
    <div className="mb-4 flex items-center gap-3">
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="Search…"
        className="w-full max-w-sm rounded border border-stone-700 bg-stone-900 px-3 py-1.5 text-sm text-stone-200 placeholder:text-stone-500 focus:border-rizzotto-gold-500 focus:outline-none"
      />
      <span className="whitespace-nowrap text-xs text-stone-500">{count} shown</span>
    </div>
  );
}

function Avatar({ url, username }: { url: string | null; username: string }) {
  if (!url) {
    return (
      <span className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-stone-700 text-xs font-medium text-stone-200">
        {username[0]?.toUpperCase() ?? '?'}
      </span>
    );
  }
  return (
    <img
      src={url}
      alt={username}
      className="h-7 w-7 rounded-full border border-stone-700 object-cover"
    />
  );
}

function RankCell({ rank }: { rank: number }) {
  if (rank === 1) {
    return <span className="font-bold text-rizzotto-gold-500">#1</span>;
  }
  return <span className="text-stone-400">#{rank}</span>;
}

/** Renders a 2v2 team cell: team name + small member avatars inline. */
function TeamCell({
  team,
  isFirst,
  provisional,
}: {
  team: TeamRef;
  isFirst: boolean;
  provisional: boolean;
}) {
  return (
    <div className="flex items-center gap-2">
      <div className="flex -space-x-1">
        {team.members.slice(0, 4).map((m) => (
          <Avatar key={m.id} url={m.avatar_url} username={m.username} />
        ))}
      </div>
      <span className={isFirst ? 'font-semibold text-rizzotto-gold-500' : 'text-stone-200'}>
        {team.name}
      </span>
      {provisional && (
        <span className="rounded border border-stone-600 px-1.5 py-0.5 text-[10px] text-stone-500">
          provisional
        </span>
      )}
    </div>
  );
}

/** Renders a 1v1 player cell: avatar + name + HoF badge + supporter tiers. */
function UserCell({
  user,
  isFirst,
  permanent,
}: {
  user: { id: string; username: string; avatar_url: string | null; tiers?: { supporter: boolean; lord: boolean; champion: boolean } };
  isFirst: boolean;
  permanent: boolean;
}) {
  return (
    <Link
      to="/users/$id"
      params={{ id: user.id }}
      className="flex items-center gap-2 hover:text-rizzotto-gold-500 transition-colors"
    >
      <Avatar url={user.avatar_url} username={user.username} />
      <span className={isFirst ? 'font-semibold text-rizzotto-gold-500' : 'text-stone-200'}>
        {user.username}
      </span>
      {permanent && (
        <span
          title="Hall of Fame — enshrined permanently"
          className="text-rizzotto-gold-400 text-xs"
        >
          ★
        </span>
      )}
      {user.tiers && <SupporterBadge tiers={user.tiers} size={14} compact />}
    </Link>
  );
}

// ---------------------------------------------------------------------------
// Filter bar: Battle-Type + Format (Rankings + Quarterly only)
// ---------------------------------------------------------------------------

const BATTLE_TYPES: { value: LeaderboardBattleType; label: string }[] = [
  { value: 'OVERALL', label: 'Overall' },
  { value: 'DOMINATION', label: 'Domination' },
  { value: 'CONQUEST', label: 'Conquest' },
  { value: 'SIEGE', label: 'Siege' },
];

function FilterBar({
  battleType,
  onBattleType,
  format,
  onFormat,
}: {
  battleType: LeaderboardBattleType;
  onBattleType: (bt: LeaderboardBattleType) => void;
  format: LeaderboardFormat;
  onFormat: (f: LeaderboardFormat) => void;
}) {
  return (
    <div className="mb-5 flex flex-wrap items-center gap-4">
      {/* Battle-type chips */}
      <div className="flex flex-wrap gap-1.5">
        {BATTLE_TYPES.map((bt) => {
          const active = battleType === bt.value;
          return (
            <button
              key={bt.value}
              type="button"
              onClick={() => onBattleType(bt.value)}
              aria-pressed={active}
              className={`rounded border px-3 py-1.5 text-sm font-medium transition-colors ${
                active
                  ? 'border-rizzotto-gold-400/70 bg-rizzotto-gold-500/20 text-rizzotto-gold-300'
                  : 'border-rizzotto-iron-700 text-rizzotto-stone-400 hover:border-rizzotto-iron-500 hover:text-rizzotto-stone-200'
              }`}
            >
              {bt.label}
            </button>
          );
        })}
      </div>

      {/* 1v1 / 2v2 toggle */}
      <div className="flex rounded border border-rizzotto-iron-700 overflow-hidden">
        {(['ONE_V_ONE', 'TWO_V_TWO'] as LeaderboardFormat[]).map((f) => {
          const active = format === f;
          return (
            <button
              key={f}
              type="button"
              onClick={() => onFormat(f)}
              aria-pressed={active}
              className={`px-4 py-1.5 text-sm font-medium transition-colors ${
                active
                  ? 'bg-rizzotto-gold-500/20 text-rizzotto-gold-300'
                  : 'text-rizzotto-stone-400 hover:text-rizzotto-stone-200'
              }`}
            >
              {f === 'ONE_V_ONE' ? '1v1' : '2v2'}
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// GS Table — shared between Rankings and Quarterly
// ---------------------------------------------------------------------------

interface GsEntry {
  rank: number;
  user?: RankingsEntry['user'] | QuarterlyEntry['user'];
  team?: TeamRef;
  generalSkill: number;
  band: number;
  gamesCount: number;
  permanent?: boolean; // Rankings only
  provisional: boolean;
}

function GsTable({
  entries,
  isLoading,
  error,
  page,
  totalPages,
  onPageChange,
}: {
  entries: GsEntry[];
  isLoading: boolean;
  error: Error | null;
  page: number;
  totalPages: number;
  onPageChange: (p: number) => void;
}) {
  const { t } = useTranslation();

  if (isLoading) {
    return <div className="py-8 text-center text-stone-400 text-sm">{t('common.loading')}</div>;
  }

  if (error) {
    return (
      <div className="rounded-md border border-red-900 bg-red-950/40 p-4 text-red-300 text-sm">
        {t('leaderboard.load_error')}
      </div>
    );
  }

  if (entries.length === 0) {
    return (
      <EmptyState
        variant="sigil"
        title={t('leaderboard.empty_title')}
        body={t('leaderboard.empty_body')}
        motto={t('leaderboard.empty_motto')}
        mottoTitle={t('leaderboard.empty_motto_title')}
      />
    );
  }

  return (
    <div data-testid="leaderboard-data-table">
      <div className={TABLE_WRAP}>
        <table className="min-w-full text-sm">
          <thead>
            <tr className={THEAD_ROW}>
              <th className="px-4 py-3 text-left font-medium text-stone-400">Rank</th>
              <th className="px-4 py-3 text-left font-medium text-stone-400">Competitor</th>
              <th
                className="px-4 py-3 text-right font-medium text-stone-400"
                title="Win% vs the average active player (from General Skill)"
              >
                GS
              </th>
              <th className="px-4 py-3 text-right font-medium text-stone-400">Games</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-stone-800/60">
            {entries.map((entry) => {
              const isFirst = entry.rank === 1;
              const rowClass = isFirst
                ? 'bg-rizzotto-gold-500/5 hover:bg-rizzotto-gold-500/10'
                : 'hover:bg-stone-800/30';
              const bandLabel = `Band ${entry.band}`;
              const pct = winPct(entry.generalSkill);
              return (
                <tr key={entry.user?.id ?? entry.team?.id ?? entry.rank} className={`transition-colors ${rowClass}`}>
                  <td className="px-4 py-3">
                    <RankCell rank={entry.rank} />
                  </td>
                  <td className="px-4 py-3">
                    {entry.user ? (
                      <UserCell
                        user={entry.user}
                        isFirst={isFirst}
                        permanent={entry.permanent ?? false}
                      />
                    ) : entry.team ? (
                      <TeamCell
                        team={entry.team}
                        isFirst={isFirst}
                        provisional={entry.provisional}
                      />
                    ) : null}
                  </td>
                  <td
                    className="px-4 py-3 text-right font-semibold text-rizzotto-gold-400 whitespace-nowrap"
                    title={`GS ${entry.generalSkill.toFixed(2)} · ${bandLabel}`}
                  >
                    {pct}%
                    <span className="ml-1.5 text-xs font-normal text-stone-500">B{entry.band}</span>
                  </td>
                  <td className="px-4 py-3 text-right text-stone-400 whitespace-nowrap">
                    {entry.gamesCount}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {totalPages > 1 && (
        <div className="mt-4 flex items-center justify-between text-sm">
          <button
            type="button"
            onClick={() => onPageChange(page - 1)}
            disabled={page <= 1}
            className="rounded border border-stone-700 px-3 py-1.5 text-stone-300 hover:border-stone-500 hover:text-stone-100 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            ← {t('common.back')}
          </button>
          <span className="text-stone-500">{t('common.page_of', { page, total: totalPages })}</span>
          <button
            type="button"
            onClick={() => onPageChange(page + 1)}
            disabled={page >= totalPages}
            className="rounded border border-stone-700 px-3 py-1.5 text-stone-300 hover:border-stone-500 hover:text-stone-100 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            {t('common.next')} →
          </button>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Rankings Tab — timeless GS board (replaces Version + Skill + Hall of Fame)
// ---------------------------------------------------------------------------

function RankingsTab() {
  const [battleType, setBattleType] = useState<LeaderboardBattleType>('OVERALL');
  const [format, setFormat] = useState<LeaderboardFormat>('ONE_V_ONE');
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');

  const { data, isLoading, error } = useQuery({
    queryKey: ['leaderboard-rankings', battleType, format, page],
    queryFn: () => getRankings({ battleType, competitorFormat: format, page, pageSize: PAGE_SIZE }),
  });

  const handleBattleType = (bt: LeaderboardBattleType) => {
    setPage(1);
    setBattleType(bt);
  };
  const handleFormat = (f: LeaderboardFormat) => {
    setPage(1);
    setFormat(f);
  };

  const raw = data?.entries ?? [];
  const entries: GsEntry[] = raw
    .filter((e) => {
      const name = e.user?.username ?? e.team?.name ?? '';
      return normalize(name).includes(normalize(search));
    })
    .map((e) => ({
      rank: e.rank,
      user: e.user,
      team: e.team,
      generalSkill: e.generalSkill,
      band: e.band,
      gamesCount: e.gamesCount,
      permanent: e.permanent,
      provisional: e.provisional,
    }));

  const totalPages = data ? Math.max(1, Math.ceil(data.total / PAGE_SIZE)) : 1;

  return (
    <div>
      <FilterBar
        battleType={battleType}
        onBattleType={handleBattleType}
        format={format}
        onFormat={handleFormat}
      />

      {data && (
        <p className="mb-4 text-xs text-stone-500">
          Listed with &ge;{data.cutoff} games &middot; Hall of Fame ★ at {data.permanenceThreshold} games
        </p>
      )}

      <LeaderboardSearch value={search} onChange={setSearch} count={entries.length} />

      <GsTable
        entries={entries}
        isLoading={isLoading}
        error={error}
        page={page}
        totalPages={totalPages}
        onPageChange={setPage}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Championship Tiles
// ---------------------------------------------------------------------------

const BATTLE_TYPE_LABELS: Record<'DOMINATION' | 'CONQUEST' | 'SIEGE', string> = {
  DOMINATION: 'Domination',
  CONQUEST: 'Conquest',
  SIEGE: 'Siege',
};

const SEEABLE_STATUSES = new Set(['DRAFT', 'OPEN_REGISTRATION', 'REGISTRATION_CLOSED']);

/** A single championship tile — quarterly or ladder. */
function ChampTile({
  title,
  tile,
  isAdmin,
}: {
  title: string;
  tile: ChampionshipTile | { size: number; tournament: { slug: string; name: string; status: string } | null; players?: number };
  isAdmin: boolean;
}) {
  const queryClient = useQueryClient();
  const [seedResult, setSeedResult] = useState<string | null>(null);

  const seedMutation = useMutation({
    mutationFn: (slug: string) => seedChampionship(slug),
    onSuccess: (res) => {
      setSeedResult(`Seeded ${res.seeded} / ${res.size} players.`);
      void queryClient.invalidateQueries({ queryKey: ['championship'] });
    },
    onError: (err: Error) => {
      setSeedResult(`Error: ${err.message}`);
    },
  });

  const { tournament, size } = tile;
  const players = 'players' in tile ? tile.players : undefined;

  // Determine need counts (only available on ChampionshipTile, not on LadderChampionship)
  const needMoreActive = 'needMoreActive' in tile ? tile.needMoreActive : 0;
  const needMoreQualified = 'needMoreQualified' in tile ? tile.needMoreQualified : 0;
  const gate = 'gate' in tile ? tile.gate : null;

  return (
    <div className="rounded-md border border-rizzotto-iron-700/70 bg-rizzotto-iron-900/60 px-4 py-3 flex flex-col gap-1.5">
      {/* Header */}
      <div className="flex items-baseline gap-2">
        <span className="text-sm font-semibold text-rizzotto-stone-200">{title}</span>
        {size > 0 && (
          <span className="text-xs text-rizzotto-stone-500">· Top {size}</span>
        )}
      </div>

      {/* Body */}
      {tournament ? (
        <div className="flex flex-wrap items-center gap-2">
          <Link
            to="/tournaments/$slug"
            params={{ slug: tournament.slug }}
            className="text-sm text-rizzotto-gold-400 hover:text-rizzotto-gold-300 underline underline-offset-2 transition-colors"
          >
            {tournament.name}
          </Link>
          <span className="rounded border border-rizzotto-iron-700 px-1.5 py-0.5 text-[10px] text-rizzotto-stone-500 font-mono uppercase">
            {tournament.status.replace(/_/g, ' ')}
          </span>
          {isAdmin && SEEABLE_STATUSES.has(tournament.status) && (
            <button
              type="button"
              disabled={seedMutation.isPending}
              onClick={() => {
                setSeedResult(null);
                seedMutation.mutate(tournament.slug);
              }}
              className="rounded border border-rizzotto-iron-600 bg-rizzotto-iron-800/60 px-2 py-0.5 text-xs text-rizzotto-stone-300 hover:border-rizzotto-gold-500/60 hover:text-rizzotto-gold-400 transition-colors disabled:opacity-50"
            >
              {seedMutation.isPending ? 'Seeding…' : 'Seed from Qualifier'}
            </button>
          )}
        </div>
      ) : size > 0 ? (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs text-rizzotto-stone-400">
            Field ready · Top {size}
          </span>
          {isAdmin && (
            <Link
              to="/tournaments/create"
              search={{ duplicate: undefined }}
              className="rounded border border-rizzotto-iron-600 bg-rizzotto-iron-800/60 px-2 py-0.5 text-xs text-rizzotto-stone-300 hover:border-rizzotto-gold-500/60 hover:text-rizzotto-gold-400 transition-colors"
            >
              + Create Final
            </Link>
          )}
        </div>
      ) : (
        <div className="text-xs text-rizzotto-stone-500">
          {players !== undefined ? (
            <span>{players} ladder players — needs a bigger field</span>
          ) : (
            <>
              {needMoreActive > 0 || needMoreQualified > 0 ? (
                <span>
                  Needs{needMoreActive > 0 ? ` ${needMoreActive} more active` : ''}
                  {needMoreActive > 0 && needMoreQualified > 0 ? ' /' : ''}
                  {needMoreQualified > 0 ? ` ${needMoreQualified} more qualified` : ''}
                  {gate !== null ? ` (gate: ${gate} games)` : ''}
                </span>
              ) : (
                <span>Not enough activity yet{gate !== null ? ` (gate: ${gate} games)` : ''}</span>
              )}
            </>
          )}
        </div>
      )}

      {/* Seed feedback */}
      {seedResult && (
        <p className={`text-xs ${seedResult.startsWith('Error') ? 'text-red-400' : 'text-rizzotto-gold-400'}`}>
          {seedResult}
        </p>
      )}
    </div>
  );
}

/** Championship tile strip for the Quarterly Qualifier board. */
function QuarterlyChampionshipTiles({
  period,
  competitorFormat,
  battleType,
  isAdmin,
}: {
  period: string;
  competitorFormat: LeaderboardFormat;
  battleType: LeaderboardBattleType;
  isAdmin: boolean;
}) {
  const { data } = useQuery({
    queryKey: ['championship', 'quarterly', period, competitorFormat],
    queryFn: () => getQuarterlyChampionships(period, competitorFormat),
    enabled: !!period,
  });

  if (!data) return null;

  const tiles = data.battleTypes;

  if (battleType !== 'OVERALL') {
    // Show only the tile matching the selected battle type
    const tile = tiles.find((t) => t.battleType === battleType);
    if (!tile) return null;
    return (
      <div className="mb-4">
        <ChampTile
          title={`${BATTLE_TYPE_LABELS[tile.battleType]} Final`}
          tile={tile}
          isAdmin={isAdmin}
        />
      </div>
    );
  }

  // Show all three side by side
  return (
    <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
      {tiles.map((tile) => (
        <ChampTile
          key={tile.battleType}
          title={`${BATTLE_TYPE_LABELS[tile.battleType]} Final`}
          tile={tile}
          isAdmin={isAdmin}
        />
      ))}
    </div>
  );
}

/** Championship tile for the Ladder board. */
function LadderChampionshipTile({
  period,
  isAdmin,
}: {
  period: string;
  isAdmin: boolean;
}) {
  const { data } = useQuery({
    queryKey: ['championship', 'ladder', period],
    queryFn: () => getLadderChampionship(period),
    enabled: !!period,
  });

  if (!data) return null;

  return (
    <div className="mb-4">
      <ChampTile
        title="Ladder Invitational"
        tile={{ size: data.size, tournament: data.tournament, players: data.players }}
        isAdmin={isAdmin}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Quarterly Qualifier Tab
// ---------------------------------------------------------------------------

function QuarterlyTab() {
  const [battleType, setBattleType] = useState<LeaderboardBattleType>('OVERALL');
  const [format, setFormat] = useState<LeaderboardFormat>('ONE_V_ONE');
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [selectedQuarter, setSelectedQuarter] = useState<string | undefined>(undefined);

  const { data: me } = useAuthQuery();
  const isAdmin = me?.role === 'ADMIN' || me?.role === 'MODERATOR';

  const { data, isLoading, error } = useQuery({
    queryKey: ['leaderboard-quarterly', battleType, format, selectedQuarter, page],
    queryFn: () =>
      getQuarterlyLeaderboard({
        battleType,
        competitorFormat: format,
        quarter: selectedQuarter,
        page,
        pageSize: PAGE_SIZE,
      }),
  });

  const handleBattleType = (bt: LeaderboardBattleType) => {
    setPage(1);
    setBattleType(bt);
  };
  const handleFormat = (f: LeaderboardFormat) => {
    setPage(1);
    setFormat(f);
  };
  const handleQuarter = (value: string) => {
    setPage(1);
    setSelectedQuarter(value || undefined);
  };

  // Periods from first response; keep them stable during re-fetches.
  const quarters: LeaderboardPeriod[] = data?.quarters ?? [];
  const activeQuarterValue = data?.quarterValue ?? '';

  const raw = data?.entries ?? [];
  const entries: GsEntry[] = raw
    .filter((e) => {
      const name = e.user?.username ?? e.team?.name ?? '';
      return normalize(name).includes(normalize(search));
    })
    .map((e) => ({
      rank: e.rank,
      user: e.user,
      team: e.team,
      generalSkill: e.generalSkill,
      band: e.band,
      gamesCount: e.gamesCount,
      provisional: e.provisional,
    }));

  const totalPages = data ? Math.max(1, Math.ceil(data.total / PAGE_SIZE)) : 1;

  // The active quarter value to use for the championship tile — prefer user selection,
  // fall back to the current quarter from the leaderboard response.
  const tileQuarter = selectedQuarter ?? activeQuarterValue;

  return (
    <div>
      <FilterBar
        battleType={battleType}
        onBattleType={handleBattleType}
        format={format}
        onFormat={handleFormat}
      />

      <div className="mb-4 flex flex-wrap items-center gap-3">
        {quarters.length > 0 && (
          <Select
            value={selectedQuarter ?? activeQuarterValue}
            onChange={(e) => handleQuarter(e.target.value)}
            className="w-auto min-w-[9rem] py-1.5 text-xs h-auto"
          >
            {quarters.map((q) => (
              <option key={q.value} value={q.value}>
                {q.label}
              </option>
            ))}
          </Select>
        )}
        {data && (
          <span className="text-xs text-stone-500">
            min. {data.gate} games this quarter &middot; {data.total} qualified
          </span>
        )}
      </div>

      {tileQuarter && (
        <QuarterlyChampionshipTiles
          period={tileQuarter}
          competitorFormat={format}
          battleType={battleType}
          isAdmin={isAdmin}
        />
      )}

      <LeaderboardSearch value={search} onChange={setSearch} count={entries.length} />

      <GsTable
        entries={entries}
        isLoading={isLoading}
        error={error}
        page={page}
        totalPages={totalPages}
        onPageChange={setPage}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Ladder Tab — monthly Open Play points (unchanged content)
// ---------------------------------------------------------------------------

function LadderTab() {
  const [search, setSearch] = useState('');
  const [selectedMonth, setSelectedMonth] = useState<string | undefined>(undefined);

  const { data: me } = useAuthQuery();
  const isAdmin = me?.role === 'ADMIN' || me?.role === 'MODERATOR';

  const { data, isLoading, error } = useQuery({
    queryKey: ['leaderboard-ladder', selectedMonth],
    queryFn: () => getLadderLeaderboard({ month: selectedMonth, pageSize: PAGE_SIZE }),
  });

  const months: LeaderboardPeriod[] = data?.months ?? [];
  const activeMonthValue = data?.monthValue ?? '';

  const handleMonth = (value: string) => {
    setSelectedMonth(value || undefined);
  };

  const entries = (data?.entries ?? []).filter((e) =>
    normalize(e.user.username).includes(normalize(search)),
  );

  const tileMonth = selectedMonth ?? activeMonthValue;

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <p className="text-sm text-stone-400">
          Monthly Open Play ladder. Points reward activity and results; resets every month, so a
          fresh grind always pays off.
        </p>
        {months.length > 0 && (
          <Select
            value={selectedMonth ?? activeMonthValue}
            onChange={(e) => handleMonth(e.target.value)}
            className="w-auto min-w-[9rem] py-1.5 text-xs h-auto"
          >
            {months.map((m) => (
              <option key={m.value} value={m.value}>
                {m.label}
              </option>
            ))}
          </Select>
        )}
      </div>

      {tileMonth && (
        <LadderChampionshipTile period={tileMonth} isAdmin={isAdmin} />
      )}
      <LeaderboardSearch value={search} onChange={setSearch} count={entries.length} />
      {isLoading && <div className="py-8 text-center text-stone-400 text-sm">Loading…</div>}
      {error && (
        <div className="rounded-md border border-red-900 bg-red-950/40 p-4 text-red-300 text-sm">
          Failed to load leaderboard.
        </div>
      )}
      {!isLoading && !error && entries.length === 0 && (
        <EmptyState
          variant="sigil"
          title="No ladder games yet"
          body="No Open Play games this month yet."
          motto="In lapide sigillata."
        />
      )}
      {!isLoading && !error && entries.length > 0 && (
        <div className={TABLE_WRAP}>
          <table className="min-w-full text-sm">
            <thead>
              <tr className={THEAD_ROW}>
                <th className="px-4 py-3 text-left font-medium text-stone-400">Rank</th>
                <th className="px-4 py-3 text-left font-medium text-stone-400">Player</th>
                <th className="px-4 py-3 text-right font-medium text-stone-400">Points</th>
                <th className="px-4 py-3 text-right font-medium text-stone-400">W–L–D</th>
                <th className="px-4 py-3 text-right font-medium text-stone-400">Games</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-stone-800/60">
              {entries.map((entry) => (
                <tr
                  key={entry.user.id}
                  className={`transition-colors ${entry.rank === 1 ? 'bg-rizzotto-gold-500/5 hover:bg-rizzotto-gold-500/10' : 'hover:bg-stone-800/30'}`}
                >
                  <td className="px-4 py-3">
                    <RankCell rank={entry.rank} />
                  </td>
                  <td className="px-4 py-3">
                    <Link
                      to="/users/$id"
                      params={{ id: entry.user.id }}
                      className="flex items-center gap-2 hover:text-rizzotto-gold-500 transition-colors"
                    >
                      <Avatar url={entry.user.avatar_url} username={entry.user.username} />
                      <span className={entry.rank === 1 ? 'font-semibold text-rizzotto-gold-500' : 'text-stone-200'}>
                        {entry.user.username}
                      </span>
                      {entry.user.tiers && (
                        <SupporterBadge tiers={entry.user.tiers} size={14} compact />
                      )}
                    </Link>
                  </td>
                  <td className="px-4 py-3 text-right font-semibold text-rizzotto-gold-400 whitespace-nowrap">
                    {entry.points}
                  </td>
                  <td className="px-4 py-3 text-right text-stone-300 whitespace-nowrap">
                    {entry.wins}–{entry.losses}–{entry.draws}
                  </td>
                  <td className="px-4 py-3 text-right text-stone-400 whitespace-nowrap">
                    {entry.games}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Champions Tab — major-tournament wins (renamed from Majors)
// ---------------------------------------------------------------------------

function ChampionsTab() {
  const [search, setSearch] = useState('');
  const { data, isLoading, error } = useQuery({
    queryKey: ['leaderboard-major-wins'],
    queryFn: getMajorWinsLeaderboard,
  });

  const entries = (data?.entries ?? []).filter((e) =>
    normalize(e.user.username).includes(normalize(search)),
  );

  return (
    <div>
      <p className="mb-4 text-sm text-stone-400">
        Champions of tournaments flagged as majors — ranked by how many they&rsquo;ve won, ties
        broken by total game wins across majors.
      </p>
      <LeaderboardSearch value={search} onChange={setSearch} count={entries.length} />

      {isLoading && <div className="py-8 text-center text-stone-400 text-sm">Loading…</div>}
      {error && (
        <div className="rounded-md border border-red-900 bg-red-950/40 p-4 text-red-300 text-sm">
          Failed to load leaderboard.
        </div>
      )}
      {!isLoading && !error && entries.length === 0 && (
        <EmptyState
          variant="sigil"
          title="No major champions yet"
          body="No one has won a major tournament yet."
          motto="In lapide sigillata."
        />
      )}
      {!isLoading && !error && entries.length > 0 && (
        <div className="overflow-x-auto rounded-md border border-rizzotto-iron-700/70 bg-rizzotto-iron-900/50 bg-stone-wall-texture bg-[length:512px_512px] bg-blend-soft-light backdrop-blur-sm">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="border-b border-rizzotto-iron-800/80 bg-rizzotto-iron-900/60">
                <th className="px-4 py-3 text-left font-medium text-stone-400">Rank</th>
                <th className="px-4 py-3 text-left font-medium text-stone-400">Player</th>
                <th className="px-4 py-3 text-right font-medium text-stone-400">Major Wins</th>
                <th
                  className="px-4 py-3 text-right font-medium text-stone-400"
                  title="Tiebreaker — total game wins across all majors"
                >
                  Game Wins
                </th>
                <th className="px-4 py-3 text-left font-medium text-stone-400">Titles</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-stone-800/60">
              {entries.map((entry) => {
                const isFirst = entry.rank === 1;
                const rowClass = isFirst
                  ? 'bg-rizzotto-gold-500/5 hover:bg-rizzotto-gold-500/10'
                  : 'hover:bg-stone-800/30';
                return (
                  <tr key={entry.user.id} className={`transition-colors ${rowClass}`}>
                    <td className="px-4 py-3">
                      <RankCell rank={entry.rank} />
                    </td>
                    <td className="px-4 py-3">
                      <Link
                        to="/users/$id"
                        params={{ id: entry.user.id }}
                        className="flex items-center gap-2 hover:text-rizzotto-gold-500 transition-colors"
                      >
                        <Avatar url={entry.user.avatar_url} username={entry.user.username} />
                        <span
                          className={
                            isFirst ? 'font-semibold text-rizzotto-gold-500' : 'text-stone-200'
                          }
                        >
                          {entry.user.username}
                        </span>
                        {entry.user.tiers && (
                          <SupporterBadge tiers={entry.user.tiers} size={14} compact />
                        )}
                      </Link>
                    </td>
                    <td className="px-4 py-3 text-right font-semibold text-rizzotto-gold-400 whitespace-nowrap">
                      {entry.wins} 🏆
                    </td>
                    <td className="px-4 py-3 text-right text-stone-300 whitespace-nowrap">
                      {entry.majorGameWins}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap gap-1">
                        {entry.tournaments.map((trn) => (
                          <Link
                            key={trn.id}
                            to="/tournaments/$slug"
                            params={{ slug: trn.slug }}
                            className="rounded border border-rizzotto-iron-700 bg-rizzotto-iron-900/60 px-2 py-0.5 text-xs text-stone-300 hover:border-rizzotto-gold-500 hover:text-rizzotto-gold-400 transition-colors"
                          >
                            {trn.name}
                          </Link>
                        ))}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Page Shell
// ---------------------------------------------------------------------------

const ALL_TABS_CONFIG: { id: Tab; label: string }[] = [
  { id: 'rankings', label: 'All-Time Skill' },
  { id: 'quarterly', label: 'Quarterly Qualifier' },
  { id: 'ladder', label: 'Ladder' },
  { id: 'champions', label: 'Champions' },
];

export function LeaderboardPage() {
  const { t } = useTranslation();
  const majorsEnabled = useMajorsEnabled();

  const tabsConfig = majorsEnabled
    ? ALL_TABS_CONFIG
    : ALL_TABS_CONFIG.filter((tc) => tc.id !== 'champions');

  const searchParams = new URLSearchParams(
    typeof window !== 'undefined' ? window.location.search : '',
  );
  const initialTab = (searchParams.get('tab') as Tab | null) ?? 'rankings';
  const validIds = tabsConfig.map((tc) => tc.id);
  const [activeTab, setActiveTab] = useState<Tab>(
    validIds.includes(initialTab as Tab) ? initialTab : 'rankings',
  );

  function changeTab(tab: Tab) {
    setActiveTab(tab);
    const url = new URL(window.location.href);
    url.searchParams.set('tab', tab);
    window.history.replaceState({}, '', url.toString());
  }

  // If the active tab has been hidden (Majors disabled while on Champions),
  // fall back to the default tab.
  const safeTab: Tab = validIds.includes(activeTab) ? activeTab : 'rankings';

  return (
    <PageShell variant="wide">
      <h1 className="font-display text-3xl font-bold text-rizzotto-gold-500 mb-6">
        {t('leaderboard.title')}
      </h1>

      {/* Tabs */}
      <div className="mb-6 flex flex-wrap gap-1 rounded-md border border-rizzotto-iron-700 bg-rizzotto-iron-900/60 p-1 w-fit">
        {tabsConfig.map(({ id, label }) => (
          <button
            key={id}
            type="button"
            onClick={() => changeTab(id)}
            className={`rounded px-4 py-1.5 text-sm font-medium transition-colors whitespace-nowrap ${
              safeTab === id
                ? 'bg-rizzotto-gold-500/20 text-rizzotto-gold-500'
                : 'text-rizzotto-stone-400 hover:text-rizzotto-stone-200'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {safeTab === 'rankings' && <RankingsTab />}
      {safeTab === 'quarterly' && <QuarterlyTab />}
      {safeTab === 'ladder' && <LadderTab />}
      {safeTab === 'champions' && majorsEnabled && <ChampionsTab />}
    </PageShell>
  );
}
