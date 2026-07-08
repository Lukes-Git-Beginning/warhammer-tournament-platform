import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate, useParams } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { z } from 'zod';
import {
  getTournament,
  patchTournament,
  getMaps,
  getFactions,
  getEligibleOwners,
  transferTournamentOwner,
  getTournamentCoHosts,
  searchCoHostCandidates,
  addTournamentCoHost,
  removeTournamentCoHost,
  type Tournament,
  type TournamentPatchInput,
  type MapDecisionMode,
  type MapPresetConfig,
} from '@/lib/api';
import { useAuthQuery } from '@/lib/auth';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { MarkdownEditor } from '@/components/ui/markdown-editor';
import { Select } from '@/components/ui/select';
import { Label, FieldError, FieldHint } from '@/components/ui/label';
import { PageShell } from '@/components/layout/PageShell';
import { PosterUploadField } from '@/components/tournament/PosterUploadField';
import { StandardRulesetCard } from '@/components/tournament/StandardRulesetCard';

// ---------------------------------------------------------------------------
// Lock helpers
// ---------------------------------------------------------------------------

function isDraftLocked(status: Tournament['status']): boolean {
  return status !== 'DRAFT';
}
function isOngoingLocked(status: Tournament['status']): boolean {
  return status === 'ONGOING' || status === 'COMPLETED';
}

function statusLabel(status: Tournament['status']): string {
  switch (status) {
    case 'DRAFT': return 'Draft';
    case 'OPEN_REGISTRATION': return 'Registration Open';
    case 'REGISTRATION_CLOSED': return 'Registration Closed';
    case 'ONGOING': return 'Ongoing';
    case 'COMPLETED': return 'Completed';
  }
}

// ---------------------------------------------------------------------------
// Map preset helpers (mirrored from TournamentCreateForm)
// ---------------------------------------------------------------------------

type EditFormData = {
  name: string;
  discord_link: string;
  is_major: boolean;
  counts_for_leaderboard: boolean;
  description: string;
  rules: string;
  standard_rules_enabled: boolean;
  restrictions: string;
  start_date: string;
  registration_deadline: string;
  max_participants: number | '';
  rounds_count: number;
  playoff_format: 'NONE' | 'TOP2' | 'TOP4' | 'TOP8';
  has_third_place_match: boolean;
  swiss_match_format: 'BO1' | 'BO3' | 'BO5';
  playoff_match_format: 'BO1' | 'BO3' | 'BO5';
  finale_match_format: 'BO1' | 'BO3' | 'BO5';
  auto_sizing: boolean;
  allow_late_join_requests: boolean;
  map_decision_mode: MapDecisionMode;
  map_pool: string[];
  map_preset_config: MapPresetConfig | null;
  format: Tournament['format'];
  mode: 'BPT' | 'SFT' | 'SLT' | 'MATRIX' | 'TWO_D_THREE' | 'FREE_PICK';
  faction_pool: string[];
  restricted_factions: string[];
  visibility: 'PUBLIC' | 'PRIVATE';
};

const EditSchema = z.object({
  name: z.string().min(3).max(120),
  discord_link: z.string().url().optional().or(z.literal('')),
});

function formatToMaxGames(fmt?: string): number {
  if (fmt === 'BO3') return 3;
  if (fmt === 'BO5') return 5;
  return 1;
}

/** Worst-case games a single player can play — pool size for per-player no-repeat. */
function maxPlayerGames(form: Partial<EditFormData>): number {
  const swissGames = formatToMaxGames(form.swiss_match_format);
  const playoffGames = formatToMaxGames(form.playoff_match_format);
  const finaleGames = formatToMaxGames(form.finale_match_format);
  const participants = form.max_participants ? Number(form.max_participants) : 0;
  const playoffExtra =
    form.playoff_format === 'TOP4'
      ? playoffGames + finaleGames
      : form.playoff_format === 'TOP8'
        ? 2 * playoffGames + finaleGames
        : 0;
  switch (form.format) {
    case 'SWISS':
    case 'LIECHTENSTEIN':
    case 'BALANCED_LIECHTENSTEIN':
      return (form.rounds_count ?? 5) * swissGames + playoffExtra;
    case 'ROUND_ROBIN':
      return (participants > 1 ? participants - 1 : 7) * swissGames + playoffExtra;
    case 'SINGLE_ELIMINATION':
      return (participants > 1 ? Math.ceil(Math.log2(participants)) : 4) * swissGames;
    case 'DOUBLE_ELIMINATION':
      return 2 * (participants > 1 ? Math.ceil(Math.log2(participants)) : 4) * swissGames;
    default:
      return (form.rounds_count ?? 5) * swissGames;
  }
}

/** Minimum map-pool size for the current mode (mirrors the create form + backend). */
function mapPoolMin(form: Partial<EditFormData>): number {
  if (form.map_decision_mode === 'RANDOM_NO_REPEAT') return Math.max(3, maxPlayerGames(form));
  return Math.max(
    3,
    formatToMaxGames(form.swiss_match_format),
    formatToMaxGames(form.playoff_match_format),
    formatToMaxGames(form.finale_match_format),
  );
}

function buildRoundKeys(form: Partial<EditFormData>): { key: string; label: string; maxGames: number }[] {
  const keys: { key: string; label: string; maxGames: number }[] = [];
  const swissGames = formatToMaxGames(form.swiss_match_format);
  const playoffGames = formatToMaxGames(form.playoff_match_format);
  const finaleGames = formatToMaxGames(form.finale_match_format);

  if (form.format === 'SWISS' || form.format === 'LIECHTENSTEIN' || form.format === 'BALANCED_LIECHTENSTEIN') {
    const rounds = form.rounds_count ?? 5;
    const roundLabel = form.format === 'LIECHTENSTEIN' ? 'Liechtenstein Round' : form.format === 'BALANCED_LIECHTENSTEIN' ? 'Balanced Liechtenstein Round' : 'Swiss Round';
    for (let i = 1; i <= rounds; i++) {
      keys.push({ key: `swiss_${i}`, label: `${roundLabel} ${i}`, maxGames: swissGames });
    }
  }

  const isSE = form.format === 'SINGLE_ELIMINATION';
  const isDE = form.format === 'DOUBLE_ELIMINATION';

  if (isSE) {
    for (let i = 1; i <= 4; i++) {
      keys.push({ key: `swiss_${i}`, label: `Elim Round ${i}`, maxGames: swissGames });
    }
  } else if (isDE) {
    for (let i = 1; i <= 4; i++) {
      keys.push({ key: `wb_round_${i}`, label: `WB Round ${i}`, maxGames: swissGames });
    }
    for (let i = 1; i <= 6; i++) {
      keys.push({ key: `lb_round_${i}`, label: `LB Round ${i}`, maxGames: swissGames });
    }
  }

  const hasPlayoffs = isSE || isDE || form.playoff_format === 'TOP4' || form.playoff_format === 'TOP8';

  if (hasPlayoffs) {
    if (form.playoff_format === 'TOP8') {
      keys.push({ key: 'playoff_qf', label: 'Quarterfinals', maxGames: playoffGames });
    }
    keys.push({ key: 'playoff_sf', label: 'Semifinals', maxGames: playoffGames });
    keys.push({ key: 'playoff_final', label: 'Grand Final', maxGames: finaleGames });
    if (form.has_third_place_match && !isDE) {
      keys.push({ key: 'playoff_third', label: 'Small Final (3rd Place)', maxGames: playoffGames });
    }
  }

  return keys;
}

const MAP_DECISION_MODES = [
  { value: 'RANDOM_NO_REPEAT' as const, label: 'Random (No Repeat)', description: 'Server picks one random map. Already-played maps are excluded.' },
  { value: 'HOST_PRESET' as const, label: 'Host Preset (1 Map)', description: 'Host sets one map per round in order. No player interaction needed.' },
  { value: 'HOST_PRESET_PICK_BAN' as const, label: 'Host Preset Ban&Pick', description: 'Host defines 3 maps per round & game. Each player bans one.' },
  { value: 'RANDOM_PICK_BAN' as const, label: 'Random Ban&Pick', description: 'Server draws 3 random maps per game. Each player bans one.' },
];

// ---------------------------------------------------------------------------
// Date helpers
// ---------------------------------------------------------------------------

function isoToLocalInput(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function localInputToIso(local: string): string {
  const d = new Date(local);
  return Number.isNaN(d.getTime()) ? local : d.toISOString();
}

// ---------------------------------------------------------------------------
// Form initialisation
// ---------------------------------------------------------------------------

function buildInitialForm(t: Tournament): EditFormData {
  return {
    name: t.name,
    discord_link: t.discord_link ?? '',
    is_major: t.is_major ?? false,
    counts_for_leaderboard: t.counts_for_leaderboard ?? true,
    description: t.description ?? '',
    rules: t.rules ?? '',
    standard_rules_enabled: t.standard_rules_enabled ?? false,
    restrictions: t.restrictions ?? '',
    start_date: isoToLocalInput(t.start_date),
    registration_deadline: isoToLocalInput(t.registration_deadline),
    max_participants: t.max_participants ?? '',
    rounds_count: t.rounds_count ?? 5,
    playoff_format: t.playoff_format ?? 'NONE',
    has_third_place_match: t.has_third_place_match ?? false,
    swiss_match_format: t.swiss_match_format ?? 'BO1',
    playoff_match_format: t.playoff_match_format ?? 'BO1',
    finale_match_format: t.finale_match_format ?? 'BO1',
    auto_sizing: t.auto_sizing ?? t.format === 'BALANCED_LIECHTENSTEIN',
    allow_late_join_requests: t.allow_late_join_requests ?? false,
    map_decision_mode: t.map_decision_mode ?? 'RANDOM_PICK_BAN',
    map_pool: (t.map_pool ?? []).map((m) => m.id),
    map_preset_config: (t.map_preset_config as MapPresetConfig | null) ?? null,
    format: t.format,
    mode: (t.mode === 'BPT' || t.mode === 'SFT' || t.mode === 'SLT' || t.mode === 'MATRIX' || t.mode === 'TWO_D_THREE' || t.mode === 'FREE_PICK') ? t.mode : 'BPT',
    faction_pool: t.faction_allowlist ?? [],
    restricted_factions: t.restricted_factions ?? [],
    visibility: t.visibility ?? 'PUBLIC',
  };
}

// ---------------------------------------------------------------------------
// Patch body builder — only includes fields that changed
// ---------------------------------------------------------------------------

function arraysEqual(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  const sa = [...a].sort();
  const sb = [...b].sort();
  return sa.every((v, i) => v === sb[i]);
}

function buildPatchBody(
  current: Tournament,
  form: EditFormData,
  initialMapIds: string[],
  initialFactionIds: string[],
  initialRestrictedIds: string[],
): TournamentPatchInput {
  const body: TournamentPatchInput = {};

  // Always-editable
  if (form.name !== current.name) body.name = form.name;
  const discordNorm = form.discord_link.trim() || null;
  if (discordNorm !== (current.discord_link ?? null)) body.discord_link = discordNorm;
  if (form.is_major !== (current.is_major ?? false)) body.is_major = form.is_major;
  if (form.counts_for_leaderboard !== (current.counts_for_leaderboard ?? true)) {
    body.counts_for_leaderboard = form.counts_for_leaderboard;
  }

  // Until-ongoing fields
  const descNorm = form.description.trim() || null;
  if (descNorm !== (current.description ?? null)) body.description = descNorm;
  // rules is non-nullable in the DB (@default("")), so clear with '' not null
  const rulesNorm = form.rules.trim();
  if (rulesNorm !== (current.rules ?? '')) body.rules = rulesNorm;
  if (form.standard_rules_enabled !== (current.standard_rules_enabled ?? false)) {
    body.standard_rules_enabled = form.standard_rules_enabled;
  }
  const restrictionsNorm = form.restrictions.trim();
  if (restrictionsNorm !== (current.restrictions ?? '')) body.restrictions = restrictionsNorm;

  const startIso = localInputToIso(form.start_date);
  if (startIso !== current.start_date) body.start_date = startIso;

  const deadlineNorm = form.registration_deadline ? localInputToIso(form.registration_deadline) : null;
  if (deadlineNorm !== (current.registration_deadline ?? null)) body.registration_deadline = deadlineNorm;

  const maxNorm = form.max_participants === '' ? null : Number(form.max_participants);
  if (maxNorm !== (current.max_participants ?? null)) body.max_participants = maxNorm;

  if (form.rounds_count !== (current.rounds_count ?? 5)) body.rounds_count = form.rounds_count;
  if (form.playoff_format !== (current.playoff_format ?? 'NONE')) body.playoff_format = form.playoff_format;
  if (form.has_third_place_match !== (current.has_third_place_match ?? false)) {
    body.has_third_place_match = form.has_third_place_match;
  }
  if (form.swiss_match_format !== (current.swiss_match_format ?? 'BO1')) body.swiss_match_format = form.swiss_match_format;
  if (form.playoff_match_format !== (current.playoff_match_format ?? 'BO1')) body.playoff_match_format = form.playoff_match_format;
  if (form.finale_match_format !== (current.finale_match_format ?? 'BO1')) body.finale_match_format = form.finale_match_format;
  if (form.auto_sizing !== (current.auto_sizing ?? current.format === 'BALANCED_LIECHTENSTEIN')) body.auto_sizing = form.auto_sizing;
  if (form.allow_late_join_requests !== (current.allow_late_join_requests ?? false)) body.allow_late_join_requests = form.allow_late_join_requests;
  if (form.map_decision_mode !== (current.map_decision_mode ?? 'RANDOM_PICK_BAN')) body.map_decision_mode = form.map_decision_mode;

  if (!arraysEqual(form.map_pool, initialMapIds)) body.map_pool = form.map_pool;

  const configStr = JSON.stringify(form.map_preset_config);
  const origStr = JSON.stringify((current.map_preset_config as MapPresetConfig | null) ?? null);
  if (configStr !== origStr) body.map_preset_config = form.map_preset_config;

  // Draft-only fields
  if (form.format !== current.format) body.format = form.format;
  if (form.mode !== current.mode) body.mode = form.mode;
  if (form.visibility !== (current.visibility ?? 'PUBLIC')) body.visibility = form.visibility;
  if (!arraysEqual(form.faction_pool, initialFactionIds)) body.faction_pool = form.faction_pool;
  if (!arraysEqual(form.restricted_factions, initialRestrictedIds)) body.restricted_factions = form.restricted_factions;

  return body;
}

// ---------------------------------------------------------------------------
// Lock status badge
// ---------------------------------------------------------------------------

function StatusBadge({ status }: { status: Tournament['status'] }) {
  const colours: Record<Tournament['status'], string> = {
    DRAFT: 'bg-rizzotto-iron-700 text-rizzotto-stone-400',
    OPEN_REGISTRATION: 'bg-emerald-900/60 text-emerald-400',
    REGISTRATION_CLOSED: 'bg-amber-900/60 text-amber-400',
    ONGOING: 'bg-blue-900/60 text-blue-400',
    COMPLETED: 'bg-rizzotto-iron-700 text-rizzotto-stone-500',
  };
  return (
    <span className={`inline-flex items-center rounded px-2 py-0.5 text-xs font-semibold uppercase tracking-wider ${colours[status]}`}>
      {statusLabel(status)}
    </span>
  );
}

function LockNote({ children }: { children: React.ReactNode }) {
  return (
    <p className="mt-1 text-xs text-rizzotto-stone-600 flex items-center gap-1">
      <span>🔒</span>
      <span>{children}</span>
    </p>
  );
}

// ---------------------------------------------------------------------------
// Transfer Ownership (admin only)
// ---------------------------------------------------------------------------

function TransferOwnerSection({ slug, currentOwnerId }: { slug: string; currentOwnerId: string }) {
  const queryClient = useQueryClient();
  const { data: owners = [] } = useQuery({
    queryKey: ['eligible-owners'],
    queryFn: getEligibleOwners,
  });
  const [selectedId, setSelectedId] = useState(currentOwnerId);
  const mutation = useMutation({
    mutationFn: (id: string) => transferTournamentOwner(slug, id),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['tournament', slug] }),
  });

  return (
    <div className="border-t border-rizzotto-iron-600 pt-6 mt-6">
      <h3 className="text-sm font-semibold text-rizzotto-stone-300 mb-3">Transfer Ownership</h3>
      <div className="flex gap-3 items-center">
        <select
          value={selectedId}
          onChange={(e) => setSelectedId(e.target.value)}
          className="flex-1 bg-rizzotto-iron-800 border border-rizzotto-iron-600 rounded px-3 py-2 text-sm text-rizzotto-stone-200"
        >
          {owners.map((u) => (
            <option key={u.id} value={u.id}>
              {u.username} ({u.role})
            </option>
          ))}
        </select>
        <Button
          variant="etched"
          size="sm"
          disabled={selectedId === currentOwnerId || mutation.isPending}
          onClick={() => mutation.mutate(selectedId)}
        >
          {mutation.isPending ? 'Transferring…' : 'Transfer'}
        </Button>
      </div>
      {mutation.isSuccess && <p className="text-xs text-green-400 mt-2">Ownership transferred.</p>}
      {mutation.isError && <p className="text-xs text-red-400 mt-2">Transfer failed.</p>}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Co-hosts (owner + staff)
// ---------------------------------------------------------------------------

function CoHostsSection({ slug }: { slug: string }) {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');

  const { data: coHosts = [] } = useQuery({
    queryKey: ['co-hosts', slug],
    queryFn: () => getTournamentCoHosts(slug),
  });
  const { data: candidates = [] } = useQuery({
    queryKey: ['co-host-candidates', slug, search],
    queryFn: () => searchCoHostCandidates(slug, search),
    enabled: search.trim().length >= 2,
  });

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ['co-hosts', slug] });
    void queryClient.invalidateQueries({ queryKey: ['co-host-candidates', slug] });
  };
  const addMutation = useMutation({
    mutationFn: (userId: string) => addTournamentCoHost(slug, userId),
    onSuccess: () => {
      setSearch('');
      refresh();
    },
  });
  const removeMutation = useMutation({
    mutationFn: (userId: string) => removeTournamentCoHost(slug, userId),
    onSuccess: refresh,
  });

  return (
    <div className="border-t border-rizzotto-iron-600 pt-6 mt-6">
      <h3 className="text-sm font-semibold text-rizzotto-stone-300 mb-1">Co-hosts</h3>
      <p className="text-xs text-rizzotto-stone-500 mb-3">
        Co-hosts manage this tournament just like you — except transferring ownership or editing this list.
      </p>

      {coHosts.length > 0 ? (
        <ul className="flex flex-col gap-2 mb-3">
          {coHosts.map((u) => (
            <li
              key={u.id}
              className="flex items-center gap-2 rounded bg-rizzotto-iron-800/60 px-3 py-2"
            >
              {u.avatar_url && <img src={u.avatar_url} alt="" className="h-6 w-6 rounded-full" />}
              <span className="flex-1 text-sm text-rizzotto-stone-200">{u.username}</span>
              <button
                type="button"
                onClick={() => removeMutation.mutate(u.id)}
                disabled={removeMutation.isPending}
                className="text-xs text-red-400 hover:text-red-300 transition-colors disabled:opacity-50"
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-xs text-rizzotto-stone-500 mb-3">No co-hosts yet.</p>
      )}

      <input
        type="text"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder="Search players to add…"
        className="w-full rounded-md border border-rizzotto-iron-600 bg-rizzotto-iron-800 px-3 py-2 text-sm text-rizzotto-stone-200 placeholder-rizzotto-stone-500 focus:outline-none focus:ring-1 focus:ring-rizzotto-gold-400"
      />
      {search.trim().length >= 2 && (
        <div className="mt-1 max-h-48 overflow-y-auto rounded-md border border-rizzotto-iron-700 bg-rizzotto-iron-900">
          {candidates.length === 0 ? (
            <p className="px-3 py-2 text-xs text-rizzotto-stone-500">No matching players.</p>
          ) : (
            candidates.map((u) => (
              <button
                key={u.id}
                type="button"
                onClick={() => addMutation.mutate(u.id)}
                disabled={addMutation.isPending}
                className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-rizzotto-stone-200 transition-colors hover:bg-rizzotto-iron-800 disabled:opacity-50"
              >
                {u.avatar_url && <img src={u.avatar_url} alt="" className="h-6 w-6 rounded-full" />}
                <span>{u.username}</span>
              </button>
            ))
          )}
        </div>
      )}
      {addMutation.isError && <p className="text-xs text-red-400 mt-2">Could not add co-host.</p>}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function TournamentEditPage() {
  const { t } = useTranslation();
  const { slug } = useParams({ from: '/tournaments/$slug/edit' });
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { data: user } = useAuthQuery();

  const { data: tournament, isLoading, error } = useQuery({
    queryKey: ['tournament', slug],
    queryFn: () => getTournament(slug),
    retry: false,
  });

  const { data: mapsData } = useQuery({ queryKey: ['maps'], queryFn: getMaps });
  const allMaps = mapsData?.data ?? [];

  const { data: factionsData } = useQuery({ queryKey: ['factions'], queryFn: () => getFactions() });
  const allFactions = (factionsData?.data ?? []).map((f) => f.faction).sort((a, b) => a.name.localeCompare(b.name));

  const [form, setForm] = useState<EditFormData | null>(null);
  const [initialMapIds, setInitialMapIds] = useState<string[]>([]);
  const [initialFactionIds, setInitialFactionIds] = useState<string[]>([]);
  const [initialRestrictedIds, setInitialRestrictedIds] = useState<string[]>([]);
  const [mapSearch, setMapSearch] = useState('');
  const [factionPoolEnabled, setFactionPoolEnabled] = useState(false);
  const [restrictedFactionsEnabled, setRestrictedFactionsEnabled] = useState(false);
  const [errors, setErrors] = useState<{ name?: string; discord_link?: string }>({});

  useEffect(() => {
    if (tournament && form === null) {
      setForm(buildInitialForm(tournament));
      const mapIds = (tournament.map_pool ?? []).map((m) => m.id);
      setInitialMapIds(mapIds);
      const factionIds = tournament.faction_allowlist ?? [];
      setInitialFactionIds(factionIds);
      if (factionIds.length > 0) setFactionPoolEnabled(true);
      const restrictedIds = tournament.restricted_factions ?? [];
      setInitialRestrictedIds(restrictedIds);
      if (restrictedIds.length > 0) setRestrictedFactionsEnabled(true);
    }
  }, [tournament, form]);

  const canManage =
    !!user &&
    !!tournament &&
    (user.role === 'MODERATOR' ||
      user.role === 'ADMIN' ||
      (user.role === 'HOST' && tournament.host?.id === user.id));

  useEffect(() => {
    if (!isLoading && tournament && user && !canManage) {
      void navigate({ to: '/tournaments/$slug', params: { slug } });
    }
  }, [isLoading, tournament, user, canManage, navigate, slug]);

  const mutation = useMutation({
    mutationFn: (body: TournamentPatchInput) => patchTournament(slug, body),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['tournament', slug] });
      await queryClient.invalidateQueries({ queryKey: ['tournaments'] });
      await navigate({ to: '/tournaments/$slug', params: { slug } });
    },
  });

  if (isLoading || !tournament || !form) {
    return (
      <PageShell variant="narrow" className="text-rizzotto-stone-400">
        {t('tournament.edit.loading')}
      </PageShell>
    );
  }
  if (error) {
    return (
      <PageShell variant="narrow">
        <div className="rounded-md border border-red-900 bg-red-950/40 p-6 text-red-300 text-sm">
          {t('tournament.edit.not_found')}
        </div>
      </PageShell>
    );
  }
  if (!canManage) {
    return (
      <PageShell variant="narrow">
        <div className="rounded-md border border-red-900 bg-red-950/40 p-6 text-red-300 text-sm">
          {t('tournament.edit.forbidden')}
        </div>
      </PageShell>
    );
  }

  const draftLocked = isDraftLocked(tournament.status);
  const ongoingLocked = isOngoingLocked(tournament.status);

  function set<K extends keyof EditFormData>(key: K, value: EditFormData[K]) {
    setForm((prev) => (prev ? { ...prev, [key]: value } : prev));
  }

  function handleChange(e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) {
    const { name, value, type } = e.target;
    const v = type === 'checkbox' ? (e.target as HTMLInputElement).checked : value;
    setForm((prev) => (prev ? { ...prev, [name]: v } : prev));
    if (name === 'name' || name === 'discord_link') {
      setErrors((prev) => ({ ...prev, [name]: undefined }));
    }
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form || !tournament) return;

    const result = EditSchema.safeParse({ name: form.name, discord_link: form.discord_link });
    if (!result.success) {
      const errs: { name?: string; discord_link?: string } = {};
      for (const issue of result.error.issues) {
        const k = issue.path[0] as 'name' | 'discord_link';
        if (!errs[k]) {
          errs[k] = k === 'name' ? t('tournament.form.errors.name_min') : t('tournament.form.errors.discord_invalid');
        }
      }
      setErrors(errs);
      return;
    }

    const body = buildPatchBody(tournament, form, initialMapIds, initialFactionIds, initialRestrictedIds);
    if (Object.keys(body).length === 0) {
      void navigate({ to: '/tournaments/$slug', params: { slug } });
      return;
    }
    mutation.mutate(body);
  }

  // ---------------------------------------------------------------------------
  // Map preset config handlers
  // ---------------------------------------------------------------------------

  const config = (form.map_preset_config ?? {}) as Record<string, string[] | string[][]>;
  const isPickBan = form.map_decision_mode === 'HOST_PRESET_PICK_BAN';
  const roundKeys = buildRoundKeys(form);

  function setPresetMap(roundKey: string, gameIndex: number, mapId: string) {
    const mapsForRound = (Array.isArray(config[roundKey]) ? config[roundKey] : []) as string[];
    const updated = [...mapsForRound];
    updated[gameIndex] = mapId;
    set('map_preset_config', { ...config, [roundKey]: updated });
  }

  function togglePresetPickBan(roundKey: string, gameIndex: number, mapId: string) {
    const setsForRound = (Array.isArray(config[roundKey]) ? config[roundKey] : []) as string[][];
    const selectedForGame = (Array.isArray(setsForRound[gameIndex]) ? setsForRound[gameIndex] : []) as string[];
    const isSel = selectedForGame.includes(mapId);
    const updated = isSel ? selectedForGame.filter((id) => id !== mapId) : [...selectedForGame, mapId];
    const newSets = [...setsForRound];
    newSets[gameIndex] = updated;
    set('map_preset_config', { ...config, [roundKey]: newSets });
  }

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  const isSwissFamily = form.format === 'SWISS' || form.format === 'ROUND_ROBIN' || form.format === 'LIECHTENSTEIN';
  const isAutoSwiss = form.format === 'AUTO_SWISS';
  const isBalanced = form.format === 'BALANCED_LIECHTENSTEIN';
  const balancedAutoSized = isBalanced && form.auto_sizing;

  const actionButtons = (
    <div className="flex gap-3">
      <Button type="submit" variant="forge" size="md" disabled={mutation.isPending}>
        {mutation.isPending
          ? t('tournament.form.submitting_edit')
          : t('tournament.form.submit_edit')}
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="md"
        disabled={mutation.isPending}
        onClick={() => navigate({ to: '/tournaments/$slug', params: { slug } })}
      >
        {t('common.cancel')}
      </Button>
    </div>
  );

  return (
    <PageShell variant="narrow">
      <Link
        to="/tournaments/$slug"
        params={{ slug }}
        className="mb-6 inline-block text-xs text-rizzotto-stone-500 hover:text-rizzotto-stone-300 transition-colors"
      >
        ← Back to tournament
      </Link>

      <header className="mb-8">
        <div className="flex items-center gap-3 flex-wrap">
          <h1 className="font-display text-3xl font-bold text-rizzotto-gold-500">
            {t('tournament.edit.title')}
          </h1>
          <StatusBadge status={tournament.status} />
        </div>
        <p className="mt-2 text-sm text-rizzotto-stone-400">
          {t('tournament.edit.subtitle')}
        </p>
      </header>

      <form onSubmit={handleSubmit} className="w-full space-y-6">
        {actionButtons}

        {mutation.error && (
          <div className="rounded-md border border-red-800 bg-red-950/50 p-4 text-sm text-red-300">
            {(mutation.error as Error).message}
          </div>
        )}

        <PosterUploadField slug={slug} posterUrl={tournament.poster_url} />

        {/* ── Format & Mode ─────────────────────────────────────────────── */}
        <fieldset className="space-y-4 rounded-md border border-rizzotto-iron-700 bg-rizzotto-iron-900/60 p-4">
          <legend className="px-1 text-sm font-semibold text-rizzotto-stone-200">
            Format &amp; Mode
          </legend>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="min-w-0">
              <Label htmlFor="tef-format" required>{t('tournament.form.format')}</Label>
              {draftLocked ? (
                <>
                  <div className="mt-1 rounded-md border border-rizzotto-iron-700 bg-rizzotto-iron-900/40 px-3 py-2 text-sm text-rizzotto-stone-300">
                    {tournament.format}
                  </div>
                  <LockNote>Locked — registration is open</LockNote>
                </>
              ) : (
                <Select id="tef-format" name="format" value={form.format} onChange={handleChange}>
                  <option value="AUTO_SWISS">Auto Swiss — self-running</option>
                  <option value="SINGLE_ELIMINATION">{t('tournament.format.single_elim')}</option>
                  <option value="DOUBLE_ELIMINATION">{t('tournament.format.double_elim')}</option>
                  <option value="SWISS">{t('tournament.format.swiss')}</option>
                  <option value="ROUND_ROBIN">{t('tournament.format.round_robin')}</option>
                  <option value="LIECHTENSTEIN">{t('tournament.format.liechtenstein')}</option>
                  <option value="BALANCED_LIECHTENSTEIN">{t('tournament.format.balanced_liechtenstein')}</option>
                </Select>
              )}
            </div>
            <div className="min-w-0">
              <Label htmlFor="tef-mode">{t('tournament.form.mode')}</Label>
              {draftLocked ? (
                <>
                  <div className="mt-1 rounded-md border border-rizzotto-iron-700 bg-rizzotto-iron-900/40 px-3 py-2 text-sm text-rizzotto-stone-300">
                    {tournament.mode}
                  </div>
                  <LockNote>Locked — registration is open</LockNote>
                </>
              ) : (
                <Select id="tef-mode" name="mode" value={form.mode} onChange={handleChange}>
                  <option value="BPT">BPT — Blind Pick Tournament</option>
                  <option value="SFT">SFT — Single Faction Tournament</option>
                  <option value="SLT">SLT — Single List Tournament</option>
                  <option value="MATRIX">3×3 Matrix — Faction Matrix Pick/Ban</option>
                  <option value="TWO_D_THREE">2D3 — Draw 3 Factions per Player</option>
                  <option value="FREE_PICK">Enticity&apos;s Free Pick — SFT/Matrix Hybrid</option>
                </Select>
              )}
            </div>
          </div>
          {isAutoSwiss && (
            <div className="mt-3 rounded-lg border border-rizzotto-gold-500/30 bg-rizzotto-gold-500/5 p-3 text-sm text-rizzotto-stone-300">
              <p className="font-semibold text-rizzotto-gold-400 mb-1">Auto Swiss</p>
              <p>Match format (BO1), map mode (Random Ban&amp;Pick) and rounds are set automatically at tournament start based on check-in count. Check-in opens 1h before start time.</p>
            </div>
          )}
        </fieldset>

        {/* ── Basic Info ────────────────────────────────────────────────── */}
        <div>
          <Label htmlFor="tef-name" required>{t('tournament.form.name')}</Label>
          <Input
            id="tef-name"
            name="name"
            value={form.name}
            onChange={handleChange}
            placeholder={t('tournament.form.name_placeholder')}
          />
          <FieldError message={errors.name} />
        </div>

        <div>
          <Label htmlFor="tef-description">{t('tournament.form.description')}</Label>
          <MarkdownEditor
            id="tef-description"
            name="description"
            value={form.description}
            onChange={handleChange}
            rows={4}
            maxLength={5000}
            placeholder={t('tournament.form.description_placeholder')}
            disabled={ongoingLocked}
          />
          {ongoingLocked && <LockNote>Locked — tournament is underway</LockNote>}
        </div>

        {/* ── Schedule ──────────────────────────────────────────────────── */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="min-w-0">
            <Label htmlFor="tef-start" required>{t('tournament.form.start_date')}</Label>
            <Input
              id="tef-start"
              type="datetime-local"
              name="start_date"
              value={form.start_date}
              onChange={handleChange}
              disabled={ongoingLocked}
            />
            {ongoingLocked && <LockNote>Locked — tournament is underway</LockNote>}
          </div>
          <div className="min-w-0">
            <Label htmlFor="tef-deadline">{t('tournament.form.registration_deadline')}</Label>
            <Input
              id="tef-deadline"
              type="datetime-local"
              name="registration_deadline"
              value={form.registration_deadline}
              onChange={handleChange}
              disabled={ongoingLocked}
            />
            {ongoingLocked && <LockNote>Locked — tournament is underway</LockNote>}
          </div>
        </div>

        {/* ── Capacity ──────────────────────────────────────────────────── */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="min-w-0">
            <Label htmlFor="tef-max">{t('tournament.form.max_participants')}</Label>
            <Input
              id="tef-max"
              type="number"
              name="max_participants"
              value={form.max_participants ?? ''}
              onChange={handleChange}
              min={2}
              placeholder={t('tournament.form.max_participants_placeholder')}
              disabled={ongoingLocked}
            />
            {ongoingLocked && <LockNote>Locked — tournament is underway</LockNote>}
          </div>
        </div>

        {/* ── Match Mechanics ───────────────────────────────────────────── */}
        <fieldset className="space-y-4 rounded-md border border-rizzotto-iron-700 bg-rizzotto-iron-900/60 p-4">
          <legend className="px-1 text-sm font-semibold text-rizzotto-stone-200">
            Match Mechanics
          </legend>
          {ongoingLocked && <LockNote>Locked — tournament is underway</LockNote>}

          {isSwissFamily ? (
            <>
              {(form.format === 'SWISS' || form.format === 'LIECHTENSTEIN') && (
                <div>
                  <Label htmlFor="tef-rounds">
                    {form.format === 'LIECHTENSTEIN' ? 'Liechtenstein Rounds' : 'Swiss Rounds'}
                  </Label>
                  <div className="flex items-center gap-3 mt-1">
                    <input
                      id="tef-rounds"
                      type="range"
                      name="rounds_count"
                      min={3}
                      max={8}
                      step={1}
                      value={form.rounds_count}
                      onChange={handleChange}
                      disabled={ongoingLocked}
                      className="w-full accent-rizzotto-gold-400 disabled:opacity-50"
                    />
                    <span className="w-6 text-center font-semibold text-rizzotto-stone-200 tabular-nums">
                      {form.rounds_count}
                    </span>
                  </div>
                </div>
              )}

              <div>
                <Label>Playoff Format</Label>
                <div className="flex gap-3 mt-1 flex-wrap">
                  {(['NONE', 'TOP2', 'TOP4', 'TOP8'] as const).map((opt) => (
                    <label key={opt} className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="radio"
                        name="playoff_format"
                        value={opt}
                        checked={form.playoff_format === opt}
                        onChange={handleChange}
                        disabled={ongoingLocked}
                        className="accent-rizzotto-gold-400"
                      />
                      <span className="text-sm text-rizzotto-stone-300">{opt}</span>
                    </label>
                  ))}
                </div>
                {form.playoff_format === 'TOP8' && (
                  <FieldHint>TOP8 requires ≥16 participants at playoff start. Auto-falls back to TOP4 if below threshold.</FieldHint>
                )}
                {form.playoff_format === 'TOP4' && (
                  <FieldHint>TOP4 requires ≥8 participants at playoff start. Auto-falls back to TOP2 if below threshold.</FieldHint>
                )}
              </div>

              {form.playoff_format !== 'NONE' && (
                <label className="flex items-center gap-2 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    name="has_third_place_match"
                    checked={form.has_third_place_match}
                    onChange={handleChange}
                    disabled={ongoingLocked}
                    className="accent-rizzotto-gold-400 h-4 w-4"
                  />
                  <span className="text-sm text-rizzotto-stone-300">Third-place match (Small Final)</span>
                </label>
              )}

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                <div>
                  <Label htmlFor="tef-swiss-fmt">
                    {form.format === 'ROUND_ROBIN' ? 'Round Robin Format' : form.format === 'LIECHTENSTEIN' ? 'Liechtenstein Format' : 'Swiss Format'}
                  </Label>
                  <Select id="tef-swiss-fmt" name="swiss_match_format" value={form.swiss_match_format} onChange={handleChange} disabled={ongoingLocked}>
                    <option value="BO1">Best of 1</option>
                    <option value="BO3">Best of 3</option>
                    <option value="BO5">Best of 5</option>
                  </Select>
                </div>
                <div>
                  <Label htmlFor="tef-playoff-fmt">Playoffs Format</Label>
                  <Select id="tef-playoff-fmt" name="playoff_match_format" value={form.playoff_match_format} onChange={handleChange} disabled={ongoingLocked}>
                    <option value="BO1">Best of 1</option>
                    <option value="BO3">Best of 3</option>
                    <option value="BO5">Best of 5</option>
                  </Select>
                </div>
                <div>
                  <Label htmlFor="tef-finale-fmt">Finale Format</Label>
                  <Select id="tef-finale-fmt" name="finale_match_format" value={form.finale_match_format} onChange={handleChange} disabled={ongoingLocked}>
                    <option value="BO1">Best of 1</option>
                    <option value="BO3">Best of 3</option>
                    <option value="BO5">Best of 5</option>
                  </Select>
                </div>
              </div>
            </>
          ) : isBalanced ? (
            <>
              <label className="flex items-start gap-2 text-sm text-rizzotto-stone-300">
                <input
                  type="checkbox"
                  name="auto_sizing"
                  checked={form.auto_sizing}
                  onChange={handleChange}
                  disabled={ongoingLocked}
                  className="mt-0.5 disabled:opacity-50"
                />
                <span>
                  <span className="font-medium text-rizzotto-stone-200">Auto-size round count from check-in</span>
                  <span className="block text-xs text-rizzotto-stone-500">On: the round count is set automatically (4–7: 3R · 8–15: 5R · 16+: 4R). Off: fix the round count yourself below.</span>
                </span>
              </label>

              {!balancedAutoSized && (
                <div>
                  <Label htmlFor="tef-bali-rounds">Balanced Liechtenstein Rounds</Label>
                  <div className="flex items-center gap-3 mt-1">
                    <input
                      id="tef-bali-rounds"
                      type="range"
                      name="rounds_count"
                      min={3}
                      max={8}
                      step={1}
                      value={form.rounds_count}
                      onChange={handleChange}
                      disabled={ongoingLocked}
                      className="w-full accent-rizzotto-gold-400 disabled:opacity-50"
                    />
                    <span className="w-6 text-center font-semibold text-rizzotto-stone-200 tabular-nums">
                      {form.rounds_count}
                    </span>
                  </div>
                </div>
              )}

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                <div>
                  <Label htmlFor="tef-bali-swiss-fmt">Group Format</Label>
                  <Select id="tef-bali-swiss-fmt" name="swiss_match_format" value={form.swiss_match_format} onChange={handleChange} disabled={ongoingLocked}>
                    <option value="BO1">Best of 1</option>
                    <option value="BO3">Best of 3</option>
                    <option value="BO5">Best of 5</option>
                  </Select>
                </div>
                <div>
                  <Label htmlFor="tef-bali-playoff-fmt">Playoffs Format</Label>
                  <Select id="tef-bali-playoff-fmt" name="playoff_match_format" value={form.playoff_match_format} onChange={handleChange} disabled={ongoingLocked}>
                    <option value="BO1">Best of 1</option>
                    <option value="BO3">Best of 3</option>
                    <option value="BO5">Best of 5</option>
                  </Select>
                </div>
                <div>
                  <Label htmlFor="tef-bali-finale-fmt">Finale Format</Label>
                  <Select id="tef-bali-finale-fmt" name="finale_match_format" value={form.finale_match_format} onChange={handleChange} disabled={ongoingLocked}>
                    <option value="BO1">Best of 1</option>
                    <option value="BO3">Best of 3</option>
                    <option value="BO5">Best of 5</option>
                  </Select>
                </div>
              </div>

              <div className="rounded-lg border border-rizzotto-gold-500/30 bg-rizzotto-gold-500/5 p-3 text-sm text-rizzotto-stone-300">
                <p>Players are paired within their own skill division each round. When the group stage ends, every division runs its own playoff bracket sized to that division (TOP 2 / 4 / 8, each with a third-place match).</p>
              </div>
            </>
          ) : !isAutoSwiss ? (
            <>
              <div>
                <Label htmlFor="tef-elim-fmt">Match Format</Label>
                <Select id="tef-elim-fmt" name="swiss_match_format" value={form.swiss_match_format} onChange={handleChange} disabled={ongoingLocked}>
                  <option value="BO1">Best of 1</option>
                  <option value="BO3">Best of 3</option>
                  <option value="BO5">Best of 5</option>
                </Select>
              </div>
              {form.format === 'SINGLE_ELIMINATION' && (
                <label className="flex items-center gap-2 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    name="has_third_place_match"
                    checked={form.has_third_place_match}
                    onChange={handleChange}
                    disabled={ongoingLocked}
                    className="accent-rizzotto-gold-400 h-4 w-4"
                  />
                  <span className="text-sm text-rizzotto-stone-300">Third-place match (Small Final)</span>
                </label>
              )}
            </>
          ) : null}
        </fieldset>

        <label className="flex items-start gap-2 rounded-md border border-rizzotto-iron-700 bg-rizzotto-iron-900/60 p-4 text-sm text-rizzotto-stone-300">
          <input
            type="checkbox"
            name="allow_late_join_requests"
            checked={form.allow_late_join_requests}
            onChange={handleChange}
            className="mt-0.5"
          />
          <span>
            <span className="font-medium text-rizzotto-stone-200">Allow late-join requests</span>
            <span className="block text-xs text-rizzotto-stone-500">
              Players can request to join after the tournament has started; you approve or decline each request
              (a Discord DM plus a panel on the tournament page). Can be toggled during an ongoing tournament.
            </span>
          </span>
        </label>

        {/* ── Map Pool ──────────────────────────────────────────────────── */}
        <fieldset className="space-y-4 rounded-md border border-rizzotto-iron-700 bg-rizzotto-iron-900/60 p-4">
          <legend className="px-1 text-sm font-semibold text-rizzotto-stone-200">
            Map Pool
          </legend>
          {ongoingLocked && <LockNote>Locked — tournament is underway</LockNote>}

          {/* Map decision mode — hidden for AUTO_SWISS (always Random Ban&Pick) */}
          {!isAutoSwiss && <div>
            <Label>Map Decision Mode</Label>
            <div className="grid grid-cols-1 gap-2 mt-2 sm:grid-cols-2">
              {MAP_DECISION_MODES.map((opt) => {
                const isSelected = form.map_decision_mode === opt.value;
                return (
                  <label
                    key={opt.value}
                    className={[
                      'flex flex-col gap-0.5 rounded-md border px-3 py-2 transition-colors',
                      ongoingLocked ? 'cursor-not-allowed opacity-60' : 'cursor-pointer',
                      isSelected ? 'border-rizzotto-gold-500 bg-rizzotto-gold-500/10' : 'border-rizzotto-iron-600 hover:border-rizzotto-iron-500',
                    ].join(' ')}
                  >
                    <div className="flex items-center gap-2">
                      <input
                        type="radio"
                        name="map_decision_mode"
                        value={opt.value}
                        checked={isSelected}
                        onChange={handleChange}
                        disabled={ongoingLocked}
                        className="accent-rizzotto-gold-400 shrink-0"
                      />
                      <span className={['text-sm font-medium', isSelected ? 'text-rizzotto-gold-300' : 'text-rizzotto-stone-200'].join(' ')}>
                        {opt.label}
                      </span>
                    </div>
                    <p className="text-xs text-rizzotto-stone-500 pl-5">{opt.description}</p>
                  </label>
                );
              })}
            </div>
          </div>}

          {/* Preset configuration */}
          {(form.map_decision_mode === 'HOST_PRESET' || form.map_decision_mode === 'HOST_PRESET_PICK_BAN') && (
            <div className="space-y-3 rounded-md border border-rizzotto-iron-600 bg-rizzotto-iron-900/40 p-3">
              <p className="text-xs font-semibold text-rizzotto-stone-300 uppercase tracking-wide">
                {isPickBan ? 'Map preset per round & game (3 maps per game)' : 'Map preset per round (1 map per game)'}
              </p>
              {roundKeys.length === 0 && (
                <p className="text-xs text-rizzotto-stone-500">Select format and round count first.</p>
              )}
              {roundKeys.map(({ key, label, maxGames }) => {
                const entry = config[key];
                if (!isPickBan) {
                  const mapsForRound = (Array.isArray(entry) ? entry : []) as string[];
                  return (
                    <div key={key} className="space-y-1">
                      <p className="text-xs font-medium text-rizzotto-stone-400">{label}</p>
                      {Array.from({ length: maxGames }).map((_, gi) => (
                        <div key={gi} className="flex items-center gap-2">
                          {maxGames > 1 && <span className="text-xs text-rizzotto-stone-600 w-12 shrink-0">Game {gi + 1}</span>}
                          <select
                            value={mapsForRound[gi] ?? ''}
                            disabled={ongoingLocked}
                            onChange={(e) => setPresetMap(key, gi, e.target.value)}
                            className="flex-1 rounded border border-rizzotto-iron-600 bg-rizzotto-iron-800 px-2 py-1 text-xs text-rizzotto-stone-200 disabled:opacity-50"
                          >
                            <option value="">— Select map —</option>
                            {allMaps.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
                          </select>
                        </div>
                      ))}
                    </div>
                  );
                }
                const setsForRound = (Array.isArray(entry) ? entry : []) as string[][];
                return (
                  <div key={key} className="space-y-2">
                    <p className="text-xs font-medium text-rizzotto-stone-400">{label}</p>
                    {Array.from({ length: maxGames }).map((_, gi) => {
                      const selectedForGame = (Array.isArray(setsForRound[gi]) ? setsForRound[gi] : []) as string[];
                      return (
                        <div key={gi} className="space-y-1">
                          {maxGames > 1 && <p className="text-xs text-rizzotto-stone-600 pl-1">Game {gi + 1}</p>}
                          <div className="grid grid-cols-2 gap-1 sm:grid-cols-3 max-h-32 overflow-y-auto rounded border border-rizzotto-iron-700 p-1.5">
                            {allMaps.map((m) => {
                              const isSel = selectedForGame.includes(m.id);
                              const atMax = !isSel && selectedForGame.length >= 3;
                              return (
                                <label
                                  key={m.id}
                                  className={['flex items-center gap-1.5 rounded px-1.5 py-1 text-xs cursor-pointer', isSel ? 'bg-rizzotto-gold-500/15 text-rizzotto-gold-400' : atMax || ongoingLocked ? 'opacity-40 cursor-not-allowed text-rizzotto-stone-500' : 'hover:bg-rizzotto-iron-800 text-rizzotto-stone-300'].join(' ')}
                                >
                                  <input
                                    type="checkbox"
                                    checked={isSel}
                                    disabled={atMax || ongoingLocked}
                                    onChange={() => !ongoingLocked && togglePresetPickBan(key, gi, m.id)}
                                    className="accent-rizzotto-gold-400 shrink-0"
                                  />
                                  <span className="truncate">{m.name}</span>
                                </label>
                              );
                            })}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                );
              })}
            </div>
          )}

          {/* Flat map pool (not for preset modes) */}
          {form.map_decision_mode !== 'HOST_PRESET' && form.map_decision_mode !== 'HOST_PRESET_PICK_BAN' && (
            <>
              <div>
                <div className="flex items-center justify-between">
                  <Label>
                    Map Selection{' '}
                    <span className="text-rizzotto-stone-500 font-normal text-xs">
                      ({form.map_pool.length}/{allMaps.length} selected, min {mapPoolMin(form)})
                    </span>
                  </Label>
                  {!ongoingLocked && (
                    <button
                      type="button"
                      onClick={() => {
                        const allSelected = allMaps.every((m) => form.map_pool.includes(m.id));
                        set('map_pool', allSelected ? [] : allMaps.map((m) => m.id));
                      }}
                      className="text-xs text-rizzotto-gold-400 hover:text-rizzotto-gold-300 transition-colors"
                    >
                      {allMaps.every((m) => form.map_pool.includes(m.id)) ? 'Deselect all' : 'Select all'}
                    </button>
                  )}
                </div>
                <input
                  type="text"
                  placeholder="Search maps…"
                  value={mapSearch}
                  onChange={(e) => setMapSearch(e.target.value)}
                  disabled={ongoingLocked}
                  className="mt-1.5 w-full rounded-md border border-rizzotto-iron-600 bg-rizzotto-iron-800 px-3 py-1.5 text-sm text-rizzotto-stone-200 placeholder-rizzotto-stone-500 focus:outline-none focus:ring-1 focus:ring-rizzotto-gold-400 disabled:opacity-50"
                />
              </div>
              <div className="max-h-52 overflow-y-auto rounded-md border border-rizzotto-iron-700 p-2">
                {allMaps.length === 0 ? (
                  <p className="text-xs text-rizzotto-stone-500 text-center py-4">Loading maps…</p>
                ) : (
                  <div className="grid grid-cols-2 gap-1 sm:grid-cols-3">
                    {allMaps
                      .filter((m) => m.name.toLowerCase().includes(mapSearch.toLowerCase()))
                      .map((map) => {
                        const isSelected = form.map_pool.includes(map.id);
                        return (
                          <label
                            key={map.id}
                            className={[
                              'flex items-center gap-2 rounded px-2 py-1.5 text-sm',
                              ongoingLocked ? 'cursor-not-allowed opacity-60' : 'cursor-pointer transition-colors',
                              isSelected ? 'bg-rizzotto-gold-500/15 text-rizzotto-gold-400' : 'hover:bg-rizzotto-iron-800 text-rizzotto-stone-300',
                            ].join(' ')}
                          >
                            <input
                              type="checkbox"
                              checked={isSelected}
                              disabled={ongoingLocked}
                              onChange={() => {
                                if (ongoingLocked) return;
                                const updated = isSelected
                                  ? form.map_pool.filter((id) => id !== map.id)
                                  : [...form.map_pool, map.id];
                                set('map_pool', updated);
                              }}
                              className="accent-rizzotto-gold-400 shrink-0"
                            />
                            <span className="truncate">{map.name}</span>
                          </label>
                        );
                      })}
                  </div>
                )}
              </div>
            </>
          )}
        </fieldset>

        {/* ── Faction Pool ──────────────────────────────────────────────── */}
        <fieldset className="space-y-4 rounded-md border border-rizzotto-iron-700 bg-rizzotto-iron-900/60 p-4">
          <legend className="px-1 text-sm font-semibold text-rizzotto-stone-200">
            Faction Pool
          </legend>
          {draftLocked && <LockNote>Locked — registration is open</LockNote>}

          <label className={['flex items-center gap-3', draftLocked ? 'opacity-60 cursor-not-allowed' : 'cursor-pointer'].join(' ')}>
            <input
              type="checkbox"
              checked={factionPoolEnabled}
              disabled={draftLocked}
              onChange={(e) => {
                setFactionPoolEnabled(e.target.checked);
                if (e.target.checked) {
                  // Default to all factions selected when enabling — host deselects to ban.
                  if (form.faction_pool.length === 0) {
                    set('faction_pool', allFactions.map((f) => f.id));
                  }
                } else {
                  set('faction_pool', []);
                }
              }}
              className="h-4 w-4 rounded border-rizzotto-iron-600 bg-rizzotto-iron-800 text-rizzotto-gold-500 focus:ring-rizzotto-gold-500"
            />
            <span className="text-sm text-rizzotto-stone-300">Restrict to a faction subset</span>
          </label>
          <FieldHint>Default: all factions allowed. Enable to limit which factions players may register with.</FieldHint>

          {factionPoolEnabled && (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label>
                  Allowed Factions{' '}
                  <span className="text-rizzotto-stone-500 font-normal text-xs">
                    ({form.faction_pool.length}/{allFactions.length} selected)
                  </span>
                </Label>
                {!draftLocked && (
                  <button
                    type="button"
                    onClick={() => {
                      const allSelected = allFactions.every((f) => form.faction_pool.includes(f.id));
                      set('faction_pool', allSelected ? [] : allFactions.map((f) => f.id));
                    }}
                    className="text-xs text-rizzotto-gold-400 hover:text-rizzotto-gold-300 transition-colors"
                  >
                    {allFactions.every((f) => form.faction_pool.includes(f.id)) ? 'Deselect all' : 'Select all'}
                  </button>
                )}
              </div>
              <div className="max-h-52 overflow-y-auto rounded-md border border-rizzotto-iron-700 p-2">
                {allFactions.length === 0 ? (
                  <p className="text-xs text-rizzotto-stone-500 text-center py-4">Loading factions…</p>
                ) : (
                  <div className="grid grid-cols-2 gap-1 sm:grid-cols-3">
                    {allFactions.map((faction) => {
                      const isSelected = form.faction_pool.includes(faction.id);
                      return (
                        <label
                          key={faction.id}
                          className={[
                            'flex items-center gap-2 rounded px-2 py-1.5 text-sm',
                            draftLocked ? 'cursor-not-allowed opacity-60' : 'cursor-pointer transition-colors',
                            isSelected ? 'bg-rizzotto-gold-500/15 text-rizzotto-gold-400' : 'hover:bg-rizzotto-iron-800 text-rizzotto-stone-300',
                          ].join(' ')}
                        >
                          <input
                            type="checkbox"
                            checked={isSelected}
                            disabled={draftLocked}
                            onChange={() => {
                              if (draftLocked) return;
                              const updated = isSelected
                                ? form.faction_pool.filter((id) => id !== faction.id)
                                : [...form.faction_pool, faction.id];
                              set('faction_pool', updated);
                            }}
                            className="accent-rizzotto-gold-400 shrink-0"
                          />
                          <span
                            className="inline-block w-2.5 h-2.5 rounded-full shrink-0"
                            style={{ backgroundColor: `#${faction.color_hex}` }}
                          />
                          <span className="truncate">{faction.name}</span>
                        </label>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          )}
        </fieldset>

        {/* ── Restricted Factions ───────────────────────────────────────── */}
        <fieldset className="space-y-4 rounded-md border border-rizzotto-iron-700 bg-rizzotto-iron-900/60 p-4">
          <legend className="px-1 text-sm font-semibold text-rizzotto-stone-200">
            Restricted Factions
          </legend>

          <label className="flex cursor-pointer items-center gap-3">
            <input
              type="checkbox"
              checked={restrictedFactionsEnabled}
              onChange={(e) => {
                setRestrictedFactionsEnabled(e.target.checked);
                if (!e.target.checked) set('restricted_factions', []);
              }}
              className="h-4 w-4 rounded border-rizzotto-iron-600 bg-rizzotto-iron-800 text-rizzotto-gold-500 focus:ring-rizzotto-gold-500"
            />
            <span className="text-sm text-rizzotto-stone-300">Mark factions as restricted (nerfed)</span>
          </label>
          <FieldHint>
            Games where either player used a restricted faction will not count toward the leaderboard. Use this for factions affected by unit bans or caps.
          </FieldHint>

          {restrictedFactionsEnabled && (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label>
                  Restricted Factions{' '}
                  <span className="text-rizzotto-stone-500 font-normal text-xs">
                    ({form.restricted_factions.length} selected)
                  </span>
                </Label>
                {form.restricted_factions.length > 0 && (
                  <button
                    type="button"
                    onClick={() => set('restricted_factions', [])}
                    className="text-xs text-rizzotto-gold-400 hover:text-rizzotto-gold-300 transition-colors"
                  >
                    Clear all
                  </button>
                )}
              </div>
              <div className="max-h-52 overflow-y-auto rounded-md border border-rizzotto-iron-700 p-2">
                {allFactions.length === 0 ? (
                  <p className="text-xs text-rizzotto-stone-500 text-center py-4">Loading factions…</p>
                ) : (
                  <div className="grid grid-cols-2 gap-1 sm:grid-cols-3">
                    {allFactions.map((faction) => {
                      const isSelected = form.restricted_factions.includes(faction.id);
                      return (
                        <label
                          key={faction.id}
                          className={[
                            'flex items-center gap-2 rounded px-2 py-1.5 cursor-pointer transition-colors text-sm',
                            isSelected ? 'bg-red-900/30 text-red-300' : 'hover:bg-rizzotto-iron-800 text-rizzotto-stone-300',
                          ].join(' ')}
                        >
                          <input
                            type="checkbox"
                            checked={isSelected}
                            onChange={() => {
                              const updated = isSelected
                                ? form.restricted_factions.filter((id) => id !== faction.id)
                                : [...form.restricted_factions, faction.id];
                              set('restricted_factions', updated);
                            }}
                            className="accent-red-400 shrink-0"
                          />
                          <span
                            className="inline-block w-2.5 h-2.5 rounded-full shrink-0"
                            style={{ backgroundColor: `#${faction.color_hex}` }}
                          />
                          <span className="truncate">{faction.name}</span>
                        </label>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          )}
        </fieldset>

        {/* ── Rules (N17) ──────────────────────────────────────────────── */}
        <fieldset className="space-y-4 rounded-md border border-rizzotto-iron-700 bg-rizzotto-iron-900/60 p-4">
          <legend className="px-1 text-sm font-semibold text-rizzotto-stone-200">Rules</legend>

          <label className="flex items-center gap-2 cursor-pointer select-none">
            <input
              type="checkbox"
              name="standard_rules_enabled"
              checked={form.standard_rules_enabled}
              onChange={handleChange}
              disabled={ongoingLocked}
              className="accent-rizzotto-gold-400 h-4 w-4"
            />
            <span className="text-sm text-rizzotto-stone-300">Enable standard rules</span>
          </label>
          {form.standard_rules_enabled && <StandardRulesetCard compact />}

          <div>
            <Label htmlFor="tef-rules">Custom Rules</Label>
            <MarkdownEditor
              id="tef-rules"
              name="rules"
              value={form.rules}
              onChange={handleChange}
              rows={6}
              maxLength={10000}
              placeholder={t('tournament.form.rules_placeholder')}
              disabled={ongoingLocked}
            />
          </div>

          <div>
            <Label htmlFor="tef-restrictions">Custom Restrictions</Label>
            <MarkdownEditor
              id="tef-restrictions"
              name="restrictions"
              value={form.restrictions}
              onChange={handleChange}
              rows={4}
              maxLength={10000}
              placeholder="Faction-specific house rules, list-submission notes, …"
              disabled={ongoingLocked}
            />
          </div>
          {ongoingLocked && <LockNote>Locked — tournament is underway</LockNote>}
        </fieldset>

        {/* ── Communications ────────────────────────────────────────────── */}
        <div>
          <Label htmlFor="tef-discord">{t('tournament.form.discord_link')}</Label>
          <Input
            id="tef-discord"
            name="discord_link"
            value={form.discord_link}
            onChange={handleChange}
            placeholder="https://discord.gg/…"
          />
          <FieldError message={errors.discord_link} />
        </div>

        {/* ── Settings ──────────────────────────────────────────────────── */}
        <fieldset className="space-y-4 rounded-md border border-rizzotto-iron-700 bg-rizzotto-iron-900/60 p-4">
          <legend className="px-1 text-sm font-semibold text-rizzotto-stone-200">
            Settings
          </legend>

          <div className="min-w-0 max-w-xs">
            <Label htmlFor="tef-visibility">Visibility</Label>
            <Select
              id="tef-visibility"
              name="visibility"
              value={form.visibility}
              onChange={handleChange}
              disabled={draftLocked}
            >
              <option value="PUBLIC">Public</option>
              <option value="PRIVATE">Private</option>
            </Select>
            {draftLocked && <LockNote>Locked — registration is open</LockNote>}
          </div>

          <div className="flex flex-col gap-3">
            <label className="flex cursor-pointer items-center gap-3">
              <input
                type="checkbox"
                name="counts_for_leaderboard"
                checked={form.counts_for_leaderboard}
                onChange={handleChange}
                className="h-4 w-4 rounded border-rizzotto-iron-600 bg-rizzotto-iron-800 text-rizzotto-gold-500 focus:ring-rizzotto-gold-500"
              />
              <span className="text-sm text-rizzotto-stone-300">Counts for leaderboard</span>
            </label>
            <label className="flex cursor-pointer items-center gap-3">
              <input
                type="checkbox"
                name="is_major"
                checked={form.is_major}
                onChange={handleChange}
                className="h-4 w-4 rounded border-rizzotto-iron-600 bg-rizzotto-iron-800 text-rizzotto-gold-500 focus:ring-rizzotto-gold-500"
              />
              <span className="text-sm text-rizzotto-stone-300">Major tournament</span>
            </label>
          </div>
        </fieldset>

        {/* ── Actions ───────────────────────────────────────────────────── */}
        {actionButtons}

        {/* ── Co-hosts (owner + staff) ──────────────────────────────────── */}
        {(user.role === 'MODERATOR' ||
          user.role === 'ADMIN' ||
          tournament.host?.id === user.id) && <CoHostsSection slug={tournament.slug} />}

        {/* ── Transfer Ownership (admin only) ───────────────────────────── */}
        {user.role === 'ADMIN' && (
          <TransferOwnerSection slug={tournament.slug} currentOwnerId={tournament.host?.id ?? ''} />
        )}
      </form>
    </PageShell>
  );
}
