import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate, useParams } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { z } from 'zod';
import {
  getTournament,
  patchTournament,
  getMaps,
  getFactions,
  type Tournament,
  type TournamentPatchInput,
  type MapDecisionMode,
  type MapPresetConfig,
} from '@/lib/api';
import { useAuthQuery } from '@/lib/auth';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Select } from '@/components/ui/select';
import { Label, FieldError, FieldHint } from '@/components/ui/label';
import { PageShell } from '@/components/layout/PageShell';

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
  start_date: string;
  registration_deadline: string;
  max_participants: number | '';
  rounds_count: number;
  playoff_format: 'NONE' | 'TOP4' | 'TOP8';
  has_third_place_match: boolean;
  swiss_match_format: 'BO1' | 'BO3' | 'BO5';
  playoff_match_format: 'BO1' | 'BO3' | 'BO5';
  finale_match_format: 'BO1' | 'BO3' | 'BO5';
  map_decision_mode: MapDecisionMode;
  map_pool: string[];
  map_preset_config: MapPresetConfig | null;
  format: Tournament['format'];
  mode: 'BPT' | 'SFT' | 'SLT';
  faction_pool: string[];
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

function buildRoundKeys(form: Partial<EditFormData>): { key: string; label: string; maxGames: number }[] {
  const keys: { key: string; label: string; maxGames: number }[] = [];
  if (form.format !== 'SWISS' && form.format !== 'LIECHTENSTEIN') return keys;
  const rounds = form.rounds_count ?? 5;
  const swissGames = formatToMaxGames(form.swiss_match_format);
  const playoffGames = formatToMaxGames(form.playoff_match_format);
  const finaleGames = formatToMaxGames(form.finale_match_format);
  for (let i = 1; i <= rounds; i++) {
    keys.push({ key: `swiss_${i}`, label: `Swiss Round ${i}`, maxGames: swissGames });
  }
  if (form.playoff_format === 'TOP4') {
    keys.push({ key: 'playoff_1', label: 'Semifinal', maxGames: playoffGames });
    keys.push({ key: 'playoff_2', label: 'Final', maxGames: finaleGames });
  } else if (form.playoff_format === 'TOP8') {
    keys.push({ key: 'playoff_1', label: 'Quarterfinal', maxGames: playoffGames });
    keys.push({ key: 'playoff_2', label: 'Semifinal', maxGames: playoffGames });
    keys.push({ key: 'playoff_3', label: 'Final', maxGames: finaleGames });
  }
  return keys;
}

const MAP_DECISION_MODES = [
  { value: 'RANDOM_NO_REPEAT' as const, label: 'Random (No Repeat)', description: 'Server picks one random map. Already-played maps are excluded.' },
  { value: 'HOST_PRESET' as const, label: 'Host Preset (1 Map)', description: 'Organizer sets one map per round in order. No player interaction needed.' },
  { value: 'HOST_PRESET_PICK_BAN' as const, label: 'Host Preset Ban&Pick', description: 'Organizer defines 3 maps per round & game. Each player bans one.' },
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
    start_date: isoToLocalInput(t.start_date),
    registration_deadline: isoToLocalInput(t.registration_deadline),
    max_participants: t.max_participants ?? '',
    rounds_count: t.rounds_count ?? 5,
    playoff_format: t.playoff_format ?? 'NONE',
    has_third_place_match: t.has_third_place_match ?? false,
    swiss_match_format: t.swiss_match_format ?? 'BO1',
    playoff_match_format: t.playoff_match_format ?? 'BO1',
    finale_match_format: t.finale_match_format ?? 'BO1',
    map_decision_mode: t.map_decision_mode ?? 'RANDOM_PICK_BAN',
    map_pool: (t.map_pool ?? []).map((m) => m.id),
    map_preset_config: (t.map_preset_config as MapPresetConfig | null) ?? null,
    format: t.format,
    mode: (t.mode === 'BPT' || t.mode === 'SFT' || t.mode === 'SLT') ? t.mode : 'BPT',
    faction_pool: t.faction_allowlist ?? [],
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
  const [mapSearch, setMapSearch] = useState('');
  const [factionPoolEnabled, setFactionPoolEnabled] = useState(false);
  const [errors, setErrors] = useState<{ name?: string; discord_link?: string }>({});

  useEffect(() => {
    if (tournament && form === null) {
      setForm(buildInitialForm(tournament));
      const mapIds = (tournament.map_pool ?? []).map((m) => m.id);
      setInitialMapIds(mapIds);
      const factionIds = tournament.faction_allowlist ?? [];
      setInitialFactionIds(factionIds);
      if (factionIds.length > 0) setFactionPoolEnabled(true);
    }
  }, [tournament, form]);

  const canManage =
    !!user &&
    !!tournament &&
    (user.role === 'MODERATOR' ||
      user.role === 'ADMIN' ||
      (user.role === 'ORGANIZER' && tournament.organizer?.id === user.id));

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

    const body = buildPatchBody(tournament, form, initialMapIds, initialFactionIds);
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

  return (
    <PageShell variant="narrow">
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
        {mutation.error && (
          <div className="rounded-md border border-red-800 bg-red-950/50 p-4 text-sm text-red-300">
            {(mutation.error as Error).message}
          </div>
        )}

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
                  <option value="SINGLE_ELIMINATION">{t('tournament.format.single_elim')}</option>
                  <option value="DOUBLE_ELIMINATION">{t('tournament.format.double_elim')}</option>
                  <option value="SWISS">{t('tournament.format.swiss')}</option>
                  <option value="ROUND_ROBIN">{t('tournament.format.round_robin')}</option>
                  <option value="LIECHTENSTEIN">{t('tournament.format.liechtenstein')}</option>
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
                </Select>
              )}
            </div>
          </div>
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
          <Textarea
            id="tef-description"
            name="description"
            value={form.description}
            onChange={handleChange}
            rows={4}
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
                      max={6}
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
                  {(['NONE', 'TOP4', 'TOP8'] as const).map((opt) => (
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
          ) : (
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
          )}
        </fieldset>

        {/* ── Map Pool ──────────────────────────────────────────────────── */}
        <fieldset className="space-y-4 rounded-md border border-rizzotto-iron-700 bg-rizzotto-iron-900/60 p-4">
          <legend className="px-1 text-sm font-semibold text-rizzotto-stone-200">
            Map Pool
          </legend>
          {ongoingLocked && <LockNote>Locked — tournament is underway</LockNote>}

          <div>
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
          </div>

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
                      ({form.map_pool.length}/{allMaps.length} selected, min 3)
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
                if (!e.target.checked) set('faction_pool', []);
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

        {/* ── Rules ─────────────────────────────────────────────────────── */}
        <div>
          <Label htmlFor="tef-rules">{t('tournament.form.rules')}</Label>
          <Textarea
            id="tef-rules"
            name="rules"
            value={form.rules}
            onChange={handleChange}
            rows={6}
            placeholder={t('tournament.form.rules_placeholder')}
            className="font-mono text-sm"
            disabled={ongoingLocked}
          />
          {ongoingLocked && <LockNote>Locked — tournament is underway</LockNote>}
        </div>

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
      </form>
    </PageShell>
  );
}
